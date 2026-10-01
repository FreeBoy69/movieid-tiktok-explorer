package cc.autoyt.app;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Draw behind the status and navigation bars; the web app pads itself
        // with the --safe-area-inset-* variables SystemBars injects.
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
