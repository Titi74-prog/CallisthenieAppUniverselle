package com.callisthenie.app

import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BasalMetabolicRateRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.FloorsClimbedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.LeanBodyMassRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SkinTemperatureRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.Vo2MaxRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.Period
import java.time.ZoneId

/**
 * Pont Health Connect → JavaScript, exposé dans la WebView sous le nom « HealthBridge ».
 * Le résultat est renvoyé via window.onHealthData(json).
 * Version générique : aucune source n'est privilégiée, Health Connect fusionne les données
 * de toutes les applis autorisées (montre, balance, téléphone) selon l'ordre de priorité réglé par l'utilisateur.
 */
class HealthBridge(private val activity: ComponentActivity, private val webView: WebView) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var askedThisSession = false
    /** Fenêtre demandée par la page : "week" (lun → dim), "month" (30 j), "year" (année civile) */
    @Volatile private var period = "week"

    private val corePermissions: Set<String> = setOf(
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
        HealthPermission.getReadPermission(BasalMetabolicRateRecord::class),
        HealthPermission.getReadPermission(FloorsClimbedRecord::class),
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(BodyFatRecord::class),
        HealthPermission.getReadPermission(LeanBodyMassRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
        HealthPermission.getReadPermission(Vo2MaxRecord::class),
        HealthPermission.getReadPermission(OxygenSaturationRecord::class)
    )
    /** Température cutanée : demandée seulement si Health Connect la prend en charge sur ce téléphone */
    private val skinTempPermission = HealthPermission.getReadPermission(SkinTemperatureRecord::class)

    private fun resolvePermissions(client: HealthConnectClient): Set<String> {
        val skinOk = try {
            client.features.getFeatureStatus(HealthConnectFeatures.FEATURE_SKIN_TEMPERATURE) ==
                HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
        } catch (_: Throwable) { false }
        return if (skinOk) corePermissions + skinTempPermission else corePermissions
    }

    private val permissionLauncher: ActivityResultLauncher<Set<String>> =
        activity.registerForActivityResult(
            PermissionController.createRequestPermissionResultContract()
        ) { _ -> fetch() }

    // ───────── Méthodes appelées depuis le JavaScript ─────────

    /** Demande les autorisations si besoin, puis lit les données. */
    @JavascriptInterface
    fun requestData() {
        activity.runOnUiThread {
            val status = HealthConnectClient.getSdkStatus(activity)
            if (status != HealthConnectClient.SDK_AVAILABLE) {
                send(JSONObject().put("status",
                    if (status == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) "update_required"
                    else "unavailable"))
                return@runOnUiThread
            }
            scope.launch {
                try {
                    val client = HealthConnectClient.getOrCreate(activity)
                    val permissions = resolvePermissions(client)
                    val granted = client.permissionController.getGrantedPermissions()
                    if (!granted.containsAll(permissions) && !askedThisSession) {
                        askedThisSession = true
                        permissionLauncher.launch(permissions)
                    } else {
                        fetch()
                    }
                } catch (e: Exception) {
                    send(JSONObject().put("status", "error").put("message", e.toString()))
                }
            }
        }
    }

    /** Comme requestData(), avec la période d'historique : "week", "month" ou "year". */
    @JavascriptInterface
    fun requestDataForPeriod(p: String?) {
        // v9.2 — "week:-1" = semaine précédente, "week:-2"… (navigation ◀ ▶)
        period = when {
            p == "month" || p == "year" -> p
            p != null && p.startsWith("week:") -> p
            else -> "week"
        }
        requestData()
    }

    /** Force une nouvelle demande d'autorisation (bouton « Autoriser »). */
    @JavascriptInterface
    fun askPermissions() {
        askedThisSession = false
        requestData()
    }

    /** Ouvre les réglages Health Connect (gestion des autorisations / sources). */
    @JavascriptInterface
    fun openSettings() {
        activity.runOnUiThread {
            val action = if (android.os.Build.VERSION.SDK_INT >= 34)
                "android.health.connect.action.HEALTH_HOME_SETTINGS"
            else "androidx.health.ACTION_HEALTH_CONNECT_SETTINGS"
            try { activity.startActivity(Intent(action)) } catch (_: Exception) { }
        }
    }

    fun destroy() = scope.cancel()

    // ───────── Lecture ─────────

    private fun fetch() {
        val p = period // figée pour cette lecture (plusieurs lectures peuvent se chevaucher)
        scope.launch {
            val json = try {
                withContext(Dispatchers.IO) { readAll(p) }
            } catch (e: Exception) {
                JSONObject().put("status", "error").put("message", e.toString())
            }
            send(json)
        }
    }

    private suspend fun readAll(p: String): JSONObject {
        val client = HealthConnectClient.getOrCreate(activity)
        val permissions = resolvePermissions(client)
        val granted = client.permissionController.getGrantedPermissions()
        val out = JSONObject()
        out.put("status", if (granted.isEmpty()) "denied" else "ok")
        out.put("requested", permissions.size)
        out.put("grantedCount", granted.count { it in permissions })
        out.put("updated", Instant.now().toString())
        if (granted.isEmpty()) return out

        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val nowLdt = LocalDateTime.now(zone)
        val now = Instant.now()
        // Fenêtres : semaine fixe (lundi → dimanche), 30 derniers jours, année civile
        val weekOff: Long = if (p.startsWith("week:")) (p.substringAfter(":").toLongOrNull() ?: 0L).coerceIn(-104L, 0L) else 0L
        val firstDay: LocalDate
        val lastDay: LocalDate
        when (p) {
            "year" -> { firstDay = today.withDayOfYear(1); lastDay = today.withDayOfYear(today.lengthOfYear()) }
            "month" -> { firstDay = today.minusDays(29); lastDay = today }
            else -> { firstDay = today.with(DayOfWeek.MONDAY).plusWeeks(weekOff); lastDay = firstDay.plusDays(6) }
        }
        out.put("period", if (p.startsWith("week")) "week" else p)
        out.put("weekOffset", weekOff)
        out.put("from", firstDay.toString())
        out.put("to", lastDay.toString())

        // Série quotidienne sur toute la fenêtre (jours futurs vides)
        val days = JSONArray()
        val byDay = linkedMapOf<LocalDate, JSONObject>()
        var d = firstDay
        while (!d.isAfter(lastDay)) {
            val o = JSONObject().put("date", d.toString())
            byDay[d] = o
            days.put(o)
            d = d.plusDays(1)
        }
        if (has(granted, "READ_STEPS")) safe {
            daily(client, byDay, firstDay, today, nowLdt, StepsRecord.COUNT_TOTAL) { o, v -> o.put("steps", v) }
        }
        if (has(granted, "READ_DISTANCE")) safe {
            daily(client, byDay, firstDay, today, nowLdt, DistanceRecord.DISTANCE_TOTAL) { o, v -> o.put("km", Math.round(v.inKilometers * 100.0) / 100.0) }
        }
        if (has(granted, "READ_FLOORS_CLIMBED")) safe {
            daily(client, byDay, firstDay, today, nowLdt, FloorsClimbedRecord.FLOORS_CLIMBED_TOTAL) { o, v -> o.put("floors", Math.round(v)) }
        }
        if (has(granted, "READ_RESTING_HEART_RATE")) safe {
            var token: String? = null
            do {
                val resp = client.readRecords(
                    ReadRecordsRequest(
                        RestingHeartRateRecord::class,
                        TimeRangeFilter.between(firstDay.atStartOfDay(zone).toInstant(), now),
                        ascendingOrder = true, pageSize = 1000, pageToken = token
                    )
                )
                resp.records.forEach { byDay[it.time.atZone(zone).toLocalDate()]?.put("rhr", it.beatsPerMinute) }
                token = resp.pageToken
            } while (token != null)
        }

        // Calories : total (métabolisme + activité) et actives, agrégées jour par jour
        if (has(granted, "READ_TOTAL_CALORIES_BURNED")) safe {
            daily(client, byDay, firstDay, today, nowLdt, TotalCaloriesBurnedRecord.ENERGY_TOTAL) { o, v -> o.put("kcal", Math.round(v.inKilocalories)) }
        }
        if (has(granted, "READ_ACTIVE_CALORIES_BURNED")) safe {
            daily(client, byDay, firstDay, today, nowLdt, ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL) { o, v -> o.put("active", Math.round(v.inKilocalories)) }
        }
        val calEnd = if (lastDay.isBefore(today)) lastDay else today
        if (!calEnd.isBefore(firstDay)) safe { sessions(client, granted, byDay, firstDay, calEnd, today, zone, now) }
        out.put("days", days)

        readBody(client, granted, out, now)
        readSleep(client, granted, out, zone, now)
        readHeart(client, granted, out, today, zone, now)
        return out
    }

    // ───────── Séances d'activité (toutes sources) ─────────

    private suspend fun sessions(
        client: HealthConnectClient, granted: Set<String>, byDay: Map<LocalDate, JSONObject>,
        from: LocalDate, to: LocalDate, today: LocalDate, zone: ZoneId, now: Instant
    ) {
        if (!has(granted, "READ_EXERCISE")) return
        val winStart = from.atStartOfDay(zone).toInstant()
        val winEnd = if (to == today) now else to.plusDays(1).atStartOfDay(zone).toInstant()
        val withKcal = has(granted, "READ_ACTIVE_CALORIES_BURNED")
        var token: String? = null
        do {
            val resp = client.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class,
                TimeRangeFilter.between(winStart, winEnd), ascendingOrder = true, pageSize = 500, pageToken = token))
            for (s in resp.records) {
                if (s.startTime.isBefore(winStart)) continue
                val end = minOf(s.endTime, now)
                if (!end.isAfter(s.startTime)) continue
                val o = byDay[s.startTime.atZone(zone).toLocalDate()] ?: continue
                val list = o.optJSONArray("sessions") ?: JSONArray().also { o.put("sessions", it) }
                val item = JSONObject()
                    .put("label", getExerciseLabel(s.exerciseType))
                    .put("title", s.title ?: "")
                    .put("start", s.startTime.toString())
                    .put("min", Math.round(Duration.between(s.startTime, end).seconds / 60.0))
                if (withKcal) item.put("kcal", Math.round(activeKcal(client, s.startTime, end)))
                list.put(item)
            }
            token = resp.pageToken
        } while (token != null)
    }

    /** Calories actives sur une plage (agrégat Health Connect, toutes sources). */
    private suspend fun activeKcal(client: HealthConnectClient, a: Instant, b: Instant): Double {
        if (!b.isAfter(a)) return 0.0
        return try {
            client.aggregate(
                AggregateRequest(
                    metrics = setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL),
                    timeRangeFilter = TimeRangeFilter.between(a, b)
                )
            )[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories ?: 0.0
        } catch (_: Exception) { 0.0 }
    }

    // ───────── Corps, sommeil, cœur ─────────

    private suspend fun readBody(client: HealthConnectClient, granted: Set<String>, out: JSONObject, now: Instant) {
        val last30 = TimeRangeFilter.between(now.minus(Duration.ofDays(30)), now)
        if (has(granted, "READ_WEIGHT")) safe {
            // Pesées des 400 derniers jours (import dans l'onglet Poids)
            val arr = JSONArray()
            var token: String? = null
            do {
                val resp = client.readRecords(ReadRecordsRequest(WeightRecord::class,
                    TimeRangeFilter.between(now.minus(Duration.ofDays(400)), now), ascendingOrder = true, pageSize = 1000, pageToken = token))
                resp.records.forEach { arr.put(JSONObject().put("t", it.time.toString()).put("kg", round1(it.weight.inKilograms))) }
                token = resp.pageToken
            } while (token != null)
            out.put("weights", arr)
        }
        if (has(granted, "READ_BODY_FAT")) safe {
            client.readRecords(ReadRecordsRequest(BodyFatRecord::class, last30, ascendingOrder = false, pageSize = 1))
                .records.firstOrNull()?.let {
                    out.put("bodyFat", JSONObject().put("t", it.time.toString()).put("pct", round1(it.percentage.value)))
                }
        }
        if (has(granted, "READ_LEAN_BODY_MASS")) safe {
            client.readRecords(ReadRecordsRequest(LeanBodyMassRecord::class, last30, ascendingOrder = false, pageSize = 1))
                .records.firstOrNull()?.let {
                    out.put("leanMass", JSONObject().put("t", it.time.toString()).put("kg", round1(it.mass.inKilograms)))
                }
        }
        if (has(granted, "READ_BASAL_METABOLIC_RATE")) safe {
            client.readRecords(ReadRecordsRequest(BasalMetabolicRateRecord::class, last30, ascendingOrder = false, pageSize = 1))
                .records.firstOrNull()?.let {
                    out.put("bmr", JSONObject().put("t", it.time.toString()).put("kcal", Math.round(it.basalMetabolicRate.inKilocaloriesPerDay)))
                }
        }
        if (has(granted, "READ_VO2_MAX")) safe {
            client.readRecords(ReadRecordsRequest(Vo2MaxRecord::class, last30, ascendingOrder = false, pageSize = 1))
                .records.firstOrNull()?.let {
                    out.put("vo2max", JSONObject().put("t", it.time.toString()).put("v", round1(it.vo2MillilitersPerMinuteKilogram)))
                }
        }
        // Température cutanée (lue aussi par l'onglet Poids) : absolue = référence + dernier écart
        if (has(granted, "READ_SKIN_TEMPERATURE")) safe {
            client.readRecords(
                ReadRecordsRequest(
                    SkinTemperatureRecord::class,
                    TimeRangeFilter.between(now.minus(Duration.ofDays(7)), now),
                    ascendingOrder = false, pageSize = 20
                )
            ).records.firstOrNull { it.deltas.isNotEmpty() || it.baseline != null }?.let { r ->
                val delta = r.deltas.maxByOrNull { it.time }?.delta?.inCelsius
                val base = r.baseline?.inCelsius
                if (base != null) out.put("skinTemp", round1(base + (delta ?: 0.0)))
                if (delta != null) out.put("skinTempDelta", Math.round(delta * 100.0) / 100.0)
                out.put("skinTempTime", r.endTime.toString())
            }
        }
    }

    private suspend fun readSleep(client: HealthConnectClient, granted: Set<String>, out: JSONObject, zone: ZoneId, now: Instant) {
        if (has(granted, "READ_SLEEP")) safe {
            val recs = client.readRecords(
                ReadRecordsRequest(
                    SleepSessionRecord::class,
                    TimeRangeFilter.between(now.minus(Duration.ofDays(8)), now),
                    ascendingOrder = true, pageSize = 100
                )
            ).records
            val arr = JSONArray()
            recs.forEach {
                val o = JSONObject()
                    .put("start", it.startTime.toString())
                    .put("end", it.endTime.toString())
                    .put("min", Duration.between(it.startTime, it.endTime).toMinutes())
                stageMinutes(it)?.let { st -> o.put("light", st[0]).put("deep", st[1]).put("rem", st[2]).put("awake", st[3]) }
                arr.put(o)
            }
            out.put("sleep", arr)
        }
        // SpO2 : mesures des 36 dernières heures (nuit)
        if (has(granted, "READ_OXYGEN_SATURATION")) safe {
            val arr = JSONArray()
            client.readRecords(
                ReadRecordsRequest(
                    OxygenSaturationRecord::class,
                    TimeRangeFilter.between(now.minus(Duration.ofHours(36)), now),
                    ascendingOrder = true, pageSize = 1000
                )
            ).records.forEach { arr.put(JSONObject().put("t", it.time.toString()).put("pct", round1(it.percentage.value))) }
            out.put("spo2", arr)
        }
    }

    private suspend fun readHeart(client: HealthConnectClient, granted: Set<String>, out: JSONObject, today: LocalDate, zone: ZoneId, now: Instant) {
        if (has(granted, "READ_HEART_RATE")) safe {
            val res = client.aggregate(
                AggregateRequest(
                    metrics = setOf(HeartRateRecord.BPM_MAX, HeartRateRecord.BPM_AVG),
                    timeRangeFilter = TimeRangeFilter.between(today.atStartOfDay(zone).toInstant(), now)
                )
            )
            res[HeartRateRecord.BPM_MAX]?.let { out.put("hrMaxToday", it) }
            res[HeartRateRecord.BPM_AVG]?.let { out.put("hrAvgToday", it) }
        }
        // HRV (RMSSD, ms) : dernière valeur + moyenne par jour sur 7 jours
        if (has(granted, "READ_HEART_RATE_VARIABILITY")) safe {
            val from7 = today.minusDays(6)
            val recs = client.readRecords(
                ReadRecordsRequest(
                    HeartRateVariabilityRmssdRecord::class,
                    TimeRangeFilter.between(from7.atStartOfDay(zone).toInstant(), now),
                    ascendingOrder = true, pageSize = 1000
                )
            ).records
            recs.lastOrNull()?.let {
                out.put("hrv", Math.round(it.heartRateVariabilityMillis))
                out.put("hrvTime", it.time.toString())
            }
            val perDay = linkedMapOf<LocalDate, MutableList<Double>>()
            recs.forEach { perDay.getOrPut(it.time.atZone(zone).toLocalDate()) { mutableListOf() }.add(it.heartRateVariabilityMillis) }
            val arr = JSONArray()
            var dd = from7
            while (!dd.isAfter(today)) {
                val o = JSONObject().put("date", dd.toString())
                perDay[dd]?.let { l -> o.put("ms", Math.round(l.average())) }
                arr.put(o)
                dd = dd.plusDays(1)
            }
            out.put("hrvDays", arr)
        }
    }

    // ───────── Utilitaires ─────────

    /** Libellé du type d'exercice */
    private fun getExerciseLabel(type: Int): String = when (type) {
        ExerciseSessionRecord.EXERCISE_TYPE_TENNIS -> "🎾 Tennis / padel"
        ExerciseSessionRecord.EXERCISE_TYPE_BADMINTON -> "🏸 Badminton"
        ExerciseSessionRecord.EXERCISE_TYPE_SQUASH -> "🎾 Squash"
        ExerciseSessionRecord.EXERCISE_TYPE_TABLE_TENNIS -> "🏓 Tennis de table"
        ExerciseSessionRecord.EXERCISE_TYPE_SKIING -> "🎿 Ski"
        ExerciseSessionRecord.EXERCISE_TYPE_SNOWBOARDING -> "🏂 Snowboard"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING -> "🚴 Vélo"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "🚴 Vélo d'appartement"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "🥾 Randonnée"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING -> "🏃 Course"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "🏃 Tapis de course"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "🚶 Marche"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL -> "🏊 Natation"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "🏊 Nage eau libre"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING -> "💪 Force"
        ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "💪 Haltères"
        ExerciseSessionRecord.EXERCISE_TYPE_CALISTHENICS,
        ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT -> "🏋️ Callisthénie"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "🧘 Yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_PILATES -> "🧘 Pilates / gainage"
        ExerciseSessionRecord.EXERCISE_TYPE_STRETCHING -> "🧘 Étirements"
        ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING -> "🔥 HIIT"
        ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL -> "🏃 Elliptique"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "🚣 Rameur"
        ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING -> "🪜 Escaliers"
        else -> "🏃 Activité"
    }

    /** Minutes par phase [léger, profond, paradoxal, éveillé] ; null si la session n'a pas de phases. */
    private fun stageMinutes(r: SleepSessionRecord): LongArray? {
        if (r.stages.isEmpty()) return null
        val m = longArrayOf(0, 0, 0, 0)
        r.stages.forEach { st ->
            val min = Duration.between(st.startTime, st.endTime).toMinutes()
            when (st.stage) {
                SleepSessionRecord.STAGE_TYPE_LIGHT, SleepSessionRecord.STAGE_TYPE_SLEEPING -> m[0] += min
                SleepSessionRecord.STAGE_TYPE_DEEP -> m[1] += min
                SleepSessionRecord.STAGE_TYPE_REM -> m[2] += min
                SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED,
                SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> m[3] += min
                else -> { }
            }
        }
        return m
    }

    /** Agrégation jour par jour, par tranches de 31 jours (requêtes légères même sur 1 an). */
    private suspend fun <T : Any> daily(
        client: HealthConnectClient,
        byDay: Map<LocalDate, JSONObject>,
        firstDay: LocalDate,
        today: LocalDate,
        nowLdt: LocalDateTime,
        metric: AggregateMetric<T>,
        put: (JSONObject, T) -> Unit
    ) {
        var from = firstDay
        while (!from.isAfter(today)) {
            val next = from.plusDays(31)
            val last = next.isAfter(today)
            val end = if (last) nowLdt else next.atStartOfDay()
            client.aggregateGroupByPeriod(
                AggregateGroupByPeriodRequest(
                    metrics = setOf(metric),
                    timeRangeFilter = TimeRangeFilter.between(from.atStartOfDay(), end),
                    timeRangeSlicer = Period.ofDays(1)
                )
            ).forEach { g ->
                val v = g.result[metric]
                val o = byDay[g.startTime.toLocalDate()]
                if (v != null && o != null) put(o, v)
            }
            if (last) break
            from = next
        }
    }

    /** Les autorisations ont la forme android.permission.health.READ_XXX */
    private fun has(granted: Set<String>, perm: String): Boolean = granted.any { it.endsWith(".$perm") }

    private inline fun safe(block: () -> Unit) {
        try { block() } catch (_: Exception) { }
    }

    private fun round1(v: Double): Double = Math.round(v * 10.0) / 10.0

    private fun send(json: JSONObject) {
        activity.runOnUiThread {
            webView.evaluateJavascript("window.onHealthData && window.onHealthData($json);", null)
        }
    }
}
