package com.salt.music.carmode;

import android.app.UiModeManager;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.BatteryManager;
import android.os.Build;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * 车载检测诊断模块（仅用于探测，不做门控）。
 * 输出：系统车载模式 / 音频输出路由 / USB 设备 / 已配对蓝牙设备 / 插电状态。
 * 用于在真车上实测，确定 Jovi InCar / 普通蓝牙 的可区分信号。
 */
public class CarModeModule extends ReactContextBaseJavaModule {
  private final ReactApplicationContext reactContext;

  public CarModeModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
  }

  @Override
  public String getName() {
    return "CarModeModule";
  }

  private static String audioTypeName(int type) {
    switch (type) {
      case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "SPEAKER";
      case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return "EARPIECE";
      case AudioDeviceInfo.TYPE_WIRED_HEADSET: return "WIRED_HEADSET";
      case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: return "WIRED_HEADPHONES";
      case AudioDeviceInfo.TYPE_BLUETOOTH_SCO: return "BT_SCO";
      case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP: return "BT_A2DP";
      case AudioDeviceInfo.TYPE_USB_DEVICE: return "USB_DEVICE";
      case AudioDeviceInfo.TYPE_USB_ACCESSORY: return "USB_ACCESSORY";
      case AudioDeviceInfo.TYPE_USB_HEADSET: return "USB_HEADSET";
      case AudioDeviceInfo.TYPE_DOCK: return "DOCK";
      case AudioDeviceInfo.TYPE_HDMI: return "HDMI";
      case AudioDeviceInfo.TYPE_AUX_LINE: return "AUX_LINE";
      default: return "TYPE_" + type;
    }
  }

  @ReactMethod
  public void getDiagnostics(Promise promise) {
    try {
      WritableMap result = Arguments.createMap();
      Context ctx = getReactApplicationContext();

      // 1) 系统车载模式（最干净的信号，前提是 vivo 连车时会进入 car mode）
      int uiMode = Configuration.UI_MODE_TYPE_NORMAL;
      boolean isCarMode = false;
      try {
        UiModeManager um = (UiModeManager) ctx.getSystemService(Context.UI_MODE_SERVICE);
        if (um != null) {
          uiMode = um.getCurrentModeType();
          isCarMode = uiMode == Configuration.UI_MODE_TYPE_CAR;
        }
      } catch (Throwable ignored) {}
      result.putInt("uiMode", uiMode);
      result.putBoolean("isCarMode", isCarMode);

      // 2) 音频输出设备/路由
      WritableArray audio = Arguments.createArray();
      boolean hasUsbAudio = false, hasA2dp = false, hasDock = false;
      if (Build.VERSION.SDK_INT >= 23) {
        try {
          AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
          if (am != null) {
            AudioDeviceInfo[] devs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
            for (AudioDeviceInfo d : devs) {
              int t = d.getType();
              WritableMap m = Arguments.createMap();
              m.putString("type", audioTypeName(t));
              CharSequence pn = d.getProductName();
              m.putString("productName", pn == null ? "" : pn.toString());
              audio.pushMap(m);
              if (t == AudioDeviceInfo.TYPE_USB_DEVICE || t == AudioDeviceInfo.TYPE_USB_HEADSET || t == AudioDeviceInfo.TYPE_USB_ACCESSORY) hasUsbAudio = true;
              if (t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) hasA2dp = true;
              if (t == AudioDeviceInfo.TYPE_DOCK) hasDock = true;
            }
          }
        } catch (Throwable ignored) {}
      }
      result.putArray("audioOutputs", audio);
      result.putBoolean("hasUsbAudio", hasUsbAudio);
      result.putBoolean("hasA2dp", hasA2dp);
      result.putBoolean("hasDock", hasDock);

      // 3) USB 设备（有线投屏/车机常见）
      WritableArray usb = Arguments.createArray();
      try {
        UsbManager usbManager = (UsbManager) ctx.getSystemService(Context.USB_SERVICE);
        if (usbManager != null) {
          HashMap<String, UsbDevice> list = usbManager.getDeviceList();
          for (Map.Entry<String, UsbDevice> e : list.entrySet()) {
            UsbDevice d = e.getValue();
            WritableMap m = Arguments.createMap();
            m.putString("deviceName", d.getDeviceName());
            m.putInt("vendorId", d.getVendorId());
            m.putInt("productId", d.getProductId());
            m.putString("manufacturerName", d.getManufacturerName() == null ? "" : d.getManufacturerName());
            m.putString("productName", d.getProductName() == null ? "" : d.getProductName());
            usb.pushMap(m);
          }
        }
      } catch (Throwable ignored) {}
      result.putArray("usbDevices", usb);

      // 4) 已配对蓝牙设备（含名称，便于识别车机）
      WritableArray bt = Arguments.createArray();
      String btError = "";
      try {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
          btError = "no bluetooth adapter";
        } else if (!adapter.isEnabled()) {
          btError = "bluetooth disabled";
        } else {
          Set<BluetoothDevice> bonded = adapter.getBondedDevices();
          if (bonded != null) {
            for (BluetoothDevice d : bonded) {
              WritableMap m = Arguments.createMap();
              String name = "";
              try { name = d.getName(); } catch (Throwable ignored) {}
              m.putString("name", name == null ? "" : name);
              m.putString("address", d.getAddress());
              bt.pushMap(m);
            }
          }
        }
      } catch (Throwable t) {
        btError = t.getClass().getSimpleName() + ": " + t.getMessage();
      }
      result.putArray("btBonded", bt);
      result.putString("btError", btError);

      // 5) 插电/充电状态（车载通常边充边用）
      try {
        Intent bi = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (bi != null) {
          int plugged = bi.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
          result.putInt("plugged", plugged);
          result.putBoolean("isCharging", plugged == BatteryManager.BATTERY_PLUGGED_USB
              || plugged == BatteryManager.BATTERY_PLUGGED_AC
              || plugged == BatteryManager.BATTERY_PLUGGED_WIRELESS);
        }
      } catch (Throwable ignored) {}

      result.putString("model", Build.MODEL == null ? "" : Build.MODEL);
      result.putString("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
      result.putInt("sdkInt", Build.VERSION.SDK_INT);

      promise.resolve(result);
    } catch (Throwable t) {
      promise.reject("CAR_MODE_ERR", t);
    }
  }
}
