package com.callisthenie.app;

import android.appwidget.AppWidgetManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.ComponentActivity;

public class MainActivity extends ComponentActivity {
    static final String PREFS = "callisthenie";
    private static final String ASSETS = "file:///android_asset/";
    private WebView webView;
    private HealthBridge health;
    private String currentPage = "programme";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        // Thème jour/nuit automatique
        int nightMode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        webView.setBackgroundColor(Color.parseColor(nightMode == Configuration.UI_MODE_NIGHT_YES ? "#0f0f13" : "#f2f2f6"));
        WebSettings s = webView.getSettings();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            s.setForceDark(nightMode == Configuration.UI_MODE_NIGHT_YES
                ? WebSettings.FORCE_DARK_ON
                : WebSettings.FORCE_DARK_OFF);
        }
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url != null) {
                    int hash = url.indexOf('#');
                    if (hash >= 0) url = url.substring(0, hash);
                    if (url.endsWith("respiration.html")) currentPage = "respiration";
                    else if (url.endsWith("poids.html")) currentPage = "poids";
                    else if (url.endsWith("seance_extra.html")) currentPage = "extra";
                    else if (url.endsWith("sante.html")) currentPage = "sante";
                    else currentPage = "programme";
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        // Pont « App » : version, réglages persistants, presse-papiers, widget
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public String version() {
                try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
                catch (Exception e) { return ""; }
            }
            /** Réglages persistants côté Android (écriture synchrone, conservés lors des mises à jour). */
            @JavascriptInterface
            public String getPref(String key) {
                return getSharedPreferences(PREFS, MODE_PRIVATE).getString(key, null);
            }
            @JavascriptInterface
            public void setPref(String key, String value) {
                if (value == null) getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(key).commit();
                else getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(key, value).commit();
            }
            /** Copie un texte dans le presse-papiers (sauvegarde / transfert des réglages). */
            @JavascriptInterface
            public void copyText(String text) {
                runOnUiThread(() -> {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Callisthénie", text));
                    Toast.makeText(MainActivity.this, "Réglages copiés", Toast.LENGTH_SHORT).show();
                });
            }
            /** Texte actuellement dans le presse-papiers (import des réglages). */
            @JavascriptInterface
            public String pasteText() {
                try {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm == null || !cm.hasPrimaryClip() || cm.getPrimaryClip().getItemCount() == 0) return "";
                    CharSequence t = cm.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);
                    return t == null ? "" : t.toString();
                } catch (Exception e) { return ""; }
            }
            /** Partage le texte (mail, messagerie…) pour l'envoyer vers un autre téléphone. */
            @JavascriptInterface
            public void shareText(String text) {
                runOnUiThread(() -> {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_SUBJECT, "Réglages Callisthénie");
                    i.putExtra(Intent.EXTRA_TEXT, text);
                    try { startActivity(Intent.createChooser(i, "Envoyer les réglages")); } catch (Exception ignored) { }
                });
            }
            /** Redessine le widget après modification des séances. */
            @JavascriptInterface
            public void updateWidget() {
                Context ctx = getApplicationContext();
                AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
                int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, ProgrammeWidget.class));
                for (int id : ids) ProgrammeWidget.updateWidget(ctx, mgr, id);
            }
        }, "App");

        // Pont Health Connect → JS
        health = new HealthBridge(this, webView);
        webView.addJavascriptInterface(health, "HealthBridge");

        webView.loadUrl(ASSETS + (isHealthIntent(getIntent()) ? "sante.html" : "programme.html"));
        setContentView(webView);
    }

    /** Health Connect ouvre l'app avec ces actions pour expliquer l'usage des données. */
    private boolean isHealthIntent(Intent i) {
        if (i == null || i.getAction() == null) return false;
        String a = i.getAction();
        return a.equals("androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE")
            || a.equals("android.intent.action.VIEW_PERMISSION_USAGE");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (isHealthIntent(intent)) webView.loadUrl(ASSETS + "sante.html");
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Le bouton retour ferme d'abord l'éditeur de séance s'il est ouvert
        webView.evaluateJavascript("(window.onBackKey && window.onBackKey()) ? '1' : '0'", r -> {
            if ("\"1\"".equals(r)) return;
            if (!currentPage.equals("programme")) webView.loadUrl(ASSETS + "programme.html");
            else super.onBackPressed();
        });
    }

    @Override protected void onPause() { super.onPause(); webView.onPause(); }
    @Override protected void onResume() { super.onResume(); webView.onResume(); }
    @Override protected void onDestroy() { if (health != null) health.destroy(); super.onDestroy(); }
}
