package school.bhbinternational.cbse_school_mobile

import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // The phone's Android ID, for recognising the same phone after the
        // app is reinstalled (punch phone check). Hashed in Dart before it
        // leaves the phone; never sent raw.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bhb/device").setMethodCallHandler { call, result ->
            if (call.method == "androidId") {
                result.success(Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "")
            } else {
                result.notImplemented()
            }
        }
    }
}
