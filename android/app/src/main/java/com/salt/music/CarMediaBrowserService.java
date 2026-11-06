package com.salt.music;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaControllerCompat;
import android.support.v4.media.session.MediaSessionCompat;

import androidx.media.MediaBrowserServiceCompat;

import com.guichaguri.trackplayer.service.MusicService;

import java.util.ArrayList;
import java.util.List;

/**
 * ICCOA 智慧车联《媒体应用接入标准 1.0.16》的媒体浏览器服务。
 *
 * 关键修正（文档「注册媒体会话」）：MediaSessionCompat 必须由本服务在 onCreate() 里
 * 创建并 setSessionToken()。旧实现从播放服务「借」token，而车机通常在手机刚连接、
 * APP 尚未开始播放时就来绑定，此时 token 为空 —— 车机拿不到会话，会把应用
 * 当作普通音源，之后所有 uCar 字段、媒体树、队列都不被读取。
 *
 * 现在播放服务通过反射复用同一个 MediaSessionCompat 实例（见 dependencies-patch.js），
 * 因此无论车机何时绑定，拿到的都是持有完整 metadata / queue / callback 的会话。
 */
public class CarMediaBrowserService extends MediaBrowserServiceCompat {

    private static final Object LOCK = new Object();
    private static volatile MediaSessionCompat sharedSession = null;

    private static final String ROOT_ID = "SALT_MUSIC_ROOT";
    private static final String FOLDER_PLAYING = "SALT_MUSIC_PLAYING";
    private static final String FOLDER_RECENT = "SALT_MUSIC_RECENT";
    private static final String FOLDER_FAVORITE = "SALT_MUSIC_FAVORITE";
    private static final String ITEM_CURRENT = "SALT_MUSIC_CURRENT";

    /** 供播放服务反射复用；应用模块不能被库模块直接引用，故用反射。 */
    public static MediaSessionCompat getOrCreateSession(Context context) {
        synchronized (LOCK) {
            if (sharedSession == null) {
                MediaSessionCompat s = new MediaSessionCompat(
                        context.getApplicationContext(), "SaltCarSession");
                s.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                        | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
                        | MediaSessionCompat.FLAG_HANDLES_QUEUE_COMMANDS);
                Intent launch = context.getPackageManager()
                        .getLaunchIntentForPackage(context.getPackageName());
                if (launch != null) {
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                    if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
                    s.setSessionActivity(PendingIntent.getActivity(context, 0, launch, flags));
                }
                sharedSession = s;
            }
            return sharedSession;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        // 文档第 414 行：在 onCreate() 里注册会话令牌，且只注册一次
        try {
            setSessionToken(getOrCreateSession(this).getSessionToken());
        } catch (Exception ignored) {
            // setSessionToken 重复调用等异常不应影响服务启动
        }
    }

    @Override
    public BrowserRoot onGetRoot(String clientPackageName, int clientUid, Bundle rootHints) {
        // 车机已绑定：置标记，并在当前元数据上打一个可见标记，便于确认绑定确实发生
        MusicService.carBrowserBound = true;
        try {
            MediaSessionCompat s = getOrCreateSession(this);
            MediaControllerCompat controller = s.getController();
            MediaMetadataCompat md = controller.getMetadata();
            if (md != null) {
                CharSequence t = md.getText("android.media.metadata.DISPLAY_TITLE");
                String title = t == null ? "" : t.toString();
                if (!title.startsWith("[车机]")) {
                    MediaMetadataCompat.Builder b = new MediaMetadataCompat.Builder(md);
                    b.putString("android.media.metadata.DISPLAY_TITLE", "[车机]" + title);
                    s.setMetadata(b.build());
                }
            }
        } catch (Exception ignored) {
            // 元数据尚未就绪，等播放服务写入
        }

        Bundle extras = new Bundle();
        extras.putBoolean("android.media.browse.SEARCH_SUPPORTED", true);
        return new BrowserRoot(ROOT_ID, extras);
    }

    /** PDF Page 10：MediaDescription 的其他配置（ucar.media.bundle.*）+ Page 6 分页信息。 */
    private Bundle itemExtras() {
        Bundle b = new Bundle();
        b.putString("ucar.media.bundle.VIP", "0");
        b.putString("ucar.media.bundle.IS_PLAYING", "1");
        b.putString("ucar.media.bundle.FAVORITE_STATE", "0");
        b.putString("ucar.media.bundle.COLLECT_STATE", "0");
        b.putString("ucar.media.bundle.IS_RADIO", "0");
        b.putBoolean("ucar.media.bundle.HAS_MORE", false);
        b.putInt("ucar.media.bundle.NEXT_PAGE_INDEX", 0);
        b.putInt("ucar.media.bundle.REMAIN_SIZE", 0);
        return b;
    }

    /** 从共享会话的播放队列取当前曲目描述，保证媒体树与播放器页显示同一份数据。 */
    private MediaDescriptionCompat currentDescription() {
        try {
            List<MediaSessionCompat.QueueItem> queue = getOrCreateSession(this).getController().getQueue();
            if (queue != null && !queue.isEmpty()) return queue.get(0).getDescription();
        } catch (Exception ignored) {
            // 播放服务尚未写入队列
        }
        return null;
    }

    /** PDF Page 7/10：可播放项 title=歌名、subtitle=歌手、iconUri=封面。 */
    private MediaBrowserCompat.MediaItem buildCurrentItem() {
        MediaDescriptionCompat desc = currentDescription();
        MediaDescriptionCompat.Builder b = new MediaDescriptionCompat.Builder();
        b.setMediaId(ITEM_CURRENT);
        if (desc != null) {
            b.setTitle(desc.getTitle());
            b.setSubtitle(desc.getSubtitle());
            b.setIconUri(desc.getIconUri());
        } else {
            b.setTitle("当前播放");
        }
        b.setExtras(itemExtras());
        return new MediaBrowserCompat.MediaItem(b.build(), MediaBrowserCompat.MediaItem.FLAG_PLAYABLE);
    }

    private MediaBrowserCompat.MediaItem folder(String mediaId, String title, String subtitle) {
        MediaDescriptionCompat.Builder b = new MediaDescriptionCompat.Builder();
        b.setMediaId(mediaId);
        b.setTitle(title);
        b.setSubtitle(subtitle);
        b.setExtras(itemExtras());
        return new MediaBrowserCompat.MediaItem(b.build(), MediaBrowserCompat.MediaItem.FLAG_BROWSABLE);
    }

    private List<MediaBrowserCompat.MediaItem> childrenFor(String parentId) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        if (ROOT_ID.equals(parentId)) {
            // 协议 Page 5：根子级项必须是可浏览项
            items.add(folder(FOLDER_PLAYING, "正在播放", "当前播放队列"));
            items.add(folder(FOLDER_RECENT, "最近播放", "最近听过的歌曲"));
            items.add(folder(FOLDER_FAVORITE, "我的收藏", "收藏的歌曲"));
        } else if (FOLDER_PLAYING.equals(parentId)
                || FOLDER_RECENT.equals(parentId)
                || FOLDER_FAVORITE.equals(parentId)) {
            items.add(buildCurrentItem());
        }
        return items;
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowserCompat.MediaItem>> result) {
        result.sendResult(childrenFor(parentId));
    }

    /** 协议 Page 6/7：带 options 的重载，读取分页页码与父项描述。 */
    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowserCompat.MediaItem>> result, Bundle options) {
        if (options != null) {
            options.getInt("ucar.media.bundle.PAGE_INDEX", 0);
            options.getParcelable("ucar.media.bundle.MEDIA_DESCRIPTION");
        }
        result.sendResult(childrenFor(parentId));
    }

    /** 协议 Page 11：搜索结果上下文。 */
    @Override
    public void onSearch(String query, Bundle extras, Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        if (query != null && !query.isEmpty()) items.add(buildCurrentItem());
        result.sendResult(items);
    }
}
