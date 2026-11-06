package com.salt.music;

import android.os.Bundle;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.session.MediaSessionCompat;

import androidx.media.MediaBrowserServiceCompat;

import com.guichaguri.trackplayer.service.MusicService;

import java.util.ArrayList;
import java.util.List;

/**
 * ICCOA 智慧车联开放联盟《车机投屏-媒体应用接入标准 1.0.16》
 * Page 3-5：车机通过 android.media.browse.MediaBrowserService 绑定媒体应用，
 * 应用须在 onGetRoot 返回非 null BrowserRoot，并可通过 rootHints 的 UCAR 标识区分绑定来源。
 *
 * 本服务不新建 MediaSession，而是通过 MusicService 暴露的 token 复用现有播放会话，
 * 车机拿到 MediaController 后即可读到 MetadataManager 写入的全部元数据（含 uCar 扩展字段）。
 *
 * 注：salt.5 曾把「是否发生本服务绑定」当作通道判据，实车未见车机绑定、分流未生效；
 * salt.6 起字段分流不再依赖绑定状态，本服务仅保留协议要求的绑定能力。
 */
public class CarMediaBrowserService extends MediaBrowserServiceCompat {

    private static final String ROOT_ID = "SALT_MUSIC_ROOT";
    private static final String BROWSABLE_ID = "SALT_MUSIC_PLAYING";
    private static final String PLAYABLE_ID = "SALT_MUSIC_CURRENT";

    @Override
    public void onCreate() {
        super.onCreate();
        attachSession();
    }

    /** setSessionToken 只能成功调用一次，重复调用会抛 IllegalStateException。 */
    private void attachSession() {
        MediaSessionCompat.Token token = MusicService.carSessionToken;
        if (token == null) return;
        try {
            setSessionToken(token);
        } catch (IllegalStateException ignored) {
            // 已在 onCreate 设置过，忽略
        }
    }

    @Override
    public BrowserRoot onGetRoot(String clientPackageName, int clientUid, Bundle rootHints) {
        // 协议 Page 4：始终返回非 null BrowserRoot。绑定状态不再用于字段分流。
        // 播放服务可能在绑定之后才启动，此时补挂一次 token
        attachSession();

        Bundle extras = new Bundle();
        extras.putBoolean("android.media.browse.SEARCH_SUPPORTED", true);
        return new BrowserRoot(ROOT_ID, extras);
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        if (ROOT_ID.equals(parentId)) {
            // 协议 Page 5：根子级项必须是可浏览项
            items.add(new MediaBrowserCompat.MediaItem(
                new MediaDescriptionCompat.Builder()
                    .setMediaId(BROWSABLE_ID)
                    .setTitle("正在播放")
                    .build(),
                MediaBrowserCompat.MediaItem.FLAG_BROWSABLE));
        } else if (BROWSABLE_ID.equals(parentId)) {
            items.add(new MediaBrowserCompat.MediaItem(
                new MediaDescriptionCompat.Builder()
                    .setMediaId(PLAYABLE_ID)
                    .setTitle("当前播放")
                    .build(),
                MediaBrowserCompat.MediaItem.FLAG_PLAYABLE));
        }
        result.sendResult(items);
    }
}
