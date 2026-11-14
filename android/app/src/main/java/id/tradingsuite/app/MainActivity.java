package id.tradingsuite.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * The laptop does the work; the phone is a window with a memory.
 *
 * The UI ships inside the APK and is served from a local https origin, so the
 * app opens instantly and off-network. Every /api call is forwarded to the
 * laptop and its response is cached on disk; when the laptop is away the same
 * call is answered from that cache, so the last screen still renders.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "app";
    private static final String KEY_HOST = "host";
    private static final String DEFAULT_HOST = "192.168.0.108";
    private static final String ORIGIN = "https://app.local";

    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!ORIGIN.equals(url.getScheme() + "://" + url.getHost())) {
                    return null;
                }
                String path = url.getPath() == null ? "/" : url.getPath();
                if (path.startsWith("/api/")) {
                    return proxy(request, url);
                }
                return asset(path);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    askForServer("Could not load the app shell.");
                }
            }
        });

        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                view.setPadding(0, insets.getSystemWindowInsetTop(), 0,
                        insets.getSystemWindowInsetBottom());
                return insets;
            }
        });
        root.addView(reloadButton(root));
        setContentView(root);
        root.requestApplyInsets();

        web.loadUrl(ORIGIN + "/");
    }

    // ── the app shell, out of assets ─────────────────────────────────────────
    private WebResourceResponse asset(String path) {
        String name = path.equals("/") ? "index.html" : path.substring(1);
        InputStream stream = openAsset(name);
        if (stream == null) {
            // SPA routes (/deep/BBCA, /backtest) are not files: hand back the shell.
            stream = openAsset("index.html");
            name = "index.html";
        }
        if (stream == null) {
            return null;
        }
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        return new WebResourceResponse(mime(name), "utf-8", stream);
    }

    private InputStream openAsset(String name) {
        try {
            return getAssets().open("web/" + name);
        } catch (IOException missing) {
            return null;
        }
    }

    private static String mime(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".js") || n.endsWith(".mjs")) return "application/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".json") || n.endsWith(".webmanifest")) return "application/json";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".ico")) return "image/x-icon";
        if (n.endsWith(".woff2")) return "font/woff2";
        return "text/html";
    }

    // ── /api: laptop first, disk second ──────────────────────────────────────
    private WebResourceResponse proxy(WebResourceRequest request, Uri url) {
        String target = apiBase() + url.getPath() + (url.getQuery() == null ? "" : "?" + url.getQuery());
        boolean cacheable = "GET".equalsIgnoreCase(request.getMethod());
        try {
            byte[] body = fetch(target, request);
            if (cacheable) {
                writeCache(url.toString(), body);
            }
            return json(body, "HIT");
        } catch (IOException offline) {
            byte[] cached = cacheable ? readCache(url.toString()) : null;
            if (cached != null) {
                return json(cached, "STALE");
            }
            return json(
                    ("{\"detail\":\"laptop unreachable at " + apiBase() + "\"}")
                            .getBytes(StandardCharsets.UTF_8),
                    "MISS");
        }
    }

    private byte[] fetch(String target, WebResourceRequest request) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(target).openConnection();
        conn.setConnectTimeout(3000);
        conn.setReadTimeout(30000);
        conn.setRequestMethod(request.getMethod());
        Map<String, String> incoming = request.getRequestHeaders();
        String contentType = incoming.get("Content-Type");
        if (contentType != null) {
            conn.setRequestProperty("Content-Type", contentType);
        }
        // shouldInterceptRequest cannot see the POST body, so a cached offline
        // call is bodyless; the live path never goes through this proxy.
        if (!"GET".equalsIgnoreCase(request.getMethod())) {
            conn.setDoOutput(true);
        }
        int code = conn.getResponseCode();
        InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        if (stream == null) {
            throw new IOException("empty response " + code);
        }
        byte[] body = readAll(stream);
        if (code >= 500) {
            throw new IOException("server error " + code);
        }
        return body;
    }

    private static byte[] readAll(InputStream stream) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int read;
        while ((read = stream.read(buffer)) > 0) {
            out.write(buffer, 0, read);
        }
        stream.close();
        return out.toByteArray();
    }

    private WebResourceResponse json(byte[] body, String cacheState) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-TS-Cache", cacheState);
        return new WebResourceResponse(
                "application/json", "utf-8", 200, "OK", headers,
                new ByteArrayInputStream(body));
    }

    private File cacheFile(String key) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-1");
            byte[] hash = digest.digest(key.getBytes(StandardCharsets.UTF_8));
            StringBuilder name = new StringBuilder();
            for (byte b : hash) {
                name.append(String.format("%02x", b));
            }
            File dir = new File(getCacheDir(), "api");
            if (!dir.exists()) {
                dir.mkdirs();
            }
            return new File(dir, name + ".json");
        } catch (Exception e) {
            return null;
        }
    }

    private void writeCache(String key, byte[] body) {
        File file = cacheFile(key);
        if (file == null) {
            return;
        }
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(body);
        } catch (IOException ignored) {
            // a cache miss is not an error
        }
    }

    private byte[] readCache(String key) {
        File file = cacheFile(key);
        if (file == null || !file.exists()) {
            return null;
        }
        try (InputStream in = new java.io.FileInputStream(file)) {
            return readAll(in);
        } catch (IOException e) {
            return null;
        }
    }

    // ── chrome ───────────────────────────────────────────────────────────────
    private TextView reloadButton(FrameLayout root) {
        float density = getResources().getDisplayMetrics().density;
        TextView reload = new TextView(this);
        reload.setText("\u21bb");
        reload.setTextSize(26);
        reload.setTextColor(Color.parseColor("#121110"));
        reload.setGravity(Gravity.CENTER);
        GradientDrawable disc = new GradientDrawable();
        disc.setShape(GradientDrawable.OVAL);
        disc.setColor(Color.parseColor("#e0a93c"));
        reload.setBackground(disc);
        reload.setContentDescription("Reload");
        reload.setElevation(6 * density);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                (int) (52 * density), (int) (52 * density));
        params.gravity = Gravity.BOTTOM | Gravity.END;
        params.setMargins(0, 0, (int) (16 * density), (int) (88 * density));
        reload.setLayoutParams(params);
        reload.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                web.reload();
            }
        });
        reload.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View view) {
                askForServer("Server address");
                return true;
            }
        });
        return reload;
    }

    private String host() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        return prefs.getString(KEY_HOST, DEFAULT_HOST);
    }

    private String apiBase() {
        return "http://" + host() + ":8000";
    }



    private void askForServer(String why) {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(host());
        input.setSelection(input.getText().length());

        new AlertDialog.Builder(this)
                .setTitle("Server address")
                .setMessage(why)
                .setView(input)
                .setPositiveButton("Save", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        String next = input.getText().toString().trim()
                                .replace("http://", "").replace("https://", "");
                        int colon = next.indexOf(':');
                        if (colon > 0) {
                            next = next.substring(0, colon);
                        }
                        getSharedPreferences(PREFS, MODE_PRIVATE)
                                .edit().putString(KEY_HOST, next).apply();
                        web.reload();
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
