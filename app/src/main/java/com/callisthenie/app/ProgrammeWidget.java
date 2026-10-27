package com.callisthenie.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * Widget 4×2 : séance du jour.
 * Lit la séance paramétrée dans l'appli (préférence « widget_json », écrite par seance.js :
 * tableau de 7 entrées, index 0 = dimanche … 6 = samedi, {n: nom, h: horaire, e: icône, c: couleur}).
 * Valeurs par défaut si l'appli n'a encore jamais été ouverte.
 */
public class ProgrammeWidget extends AppWidgetProvider {
    static final String[] SEANCES = {"Gainage & Récupération","Dos & Gainage","Abdos & Obliques","Circuit Métabolique Haut du Corps","Haut du Corps","Circuit Haut du Corps","Full Body + Mobilité"};
    static final String[] EMOJIS = {"🌿","A","B","C","D","E","F"};
    static final String[] HORAIRES = {"~40 min","~25 min","~20 min","~25 min","~25 min","~20 min","~35 min"};
    static final int[] COULEURS = {0xFF66BB6A,0xFF5C6BC0,0xFF26A69A,0xFF7E57C2,0xFFEF5350,0xFFFF7043,0xFFF9A825};

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) updateWidget(context, mgr, id);
    }

    static void updateWidget(Context ctx, AppWidgetManager mgr, int id) {
        int jour = Calendar.getInstance().get(Calendar.DAY_OF_WEEK) - 1; // 0 = dimanche
        String nom = SEANCES[jour], emoji = EMOJIS[jour], horaire = HORAIRES[jour];
        int couleur = COULEURS[jour];
        try {
            String js = ctx.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE).getString("widget_json", null);
            if (js != null) {
                JSONObject o = new JSONArray(js).getJSONObject(jour);
                nom = o.optString("n", nom);
                emoji = o.optString("e", emoji);
                horaire = o.optString("h", horaire);
                String c = o.optString("c", "");
                if (c.startsWith("#")) couleur = Color.parseColor(c);
            }
        } catch (Exception ignored) { }
        RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.widget_layout);
        views.setInt(R.id.widget_root, "setBackgroundColor", couleur);
        views.setTextViewText(R.id.widget_emoji, emoji);
        views.setTextViewText(R.id.widget_seance, nom);
        views.setTextViewText(R.id.widget_horaire, horaire);
        Intent intent = new Intent(ctx, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pi);
        mgr.updateAppWidget(id, views);
    }
}
