package app.hanmogeum.quit;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;

/** 저장소 루트의 웹앱(assets/www)을 전체 화면 WebView로 띄운다. */
public class MainActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(0xFF020306);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        // 길게 눌러 담배를 빠는 동작이 텍스트 선택·진동으로 가로채이지 않게 한다
        web.setOnLongClickListener(v -> true);
        web.setHapticFeedbackEnabled(false);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // 금연 기록(localStorage)
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);

        setContentView(web);
        web.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
