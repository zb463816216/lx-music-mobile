import { init as initLyricPlayer, toggleTranslation, toggleRoma, play, pause, stop, setLyric, setPlaybackRate, setLyricSendState } from '@/core/lyric'
import { updateSetting } from '@/core/common'
import { onDesktopLyricPositionChange, showDesktopLyric, onLyricLinePlay } from '@/core/desktopLyric'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { updateNowPlayingTitles } from '@/plugins/player/utils'
import { setLastLyric } from '@/core/player/playInfo'

// 开关优先级：车载歌词 > 完整蓝牙歌词 > 蓝牙歌词。
// 返回当前生效模式：'car'（只写 ucar 字段）| 'full'（整首歌词）| 'bt'（逐句标准 title）| 'none'
const getLyricMode = (): 'car' | 'full' | 'bt' | 'none' => {
  const isCar = settingState.setting['player.isShowCarLyric']
  const isFull = settingState.setting['player.isShowBluetoothFullLyric']
  const isBt = settingState.setting['player.isShowBluetoothLyric']
  if (isCar) return 'car'
  if (isFull) return 'full'
  if (isBt) return 'bt'
  return 'none'
}

const updateRemoteLyric = async(lrc?: string) => {
  setLastLyric(lrc)
  const mode = getLyricMode()
  const name = playerState.musicInfo.name
  const singer = playerState.musicInfo.singer ?? ''
  const album = playerState.musicInfo.album ?? ''

  if (lrc == null) {
    // 无歌词（暂停/切歌）：恢复歌名
    if (mode == 'car') {
      // 车载模式：只写 ucar 歌名
      void updateNowPlayingTitles({ title: name, artist: singer, album, carMode: true })
    } else {
      void updateNowPlayingTitles({ title: name, artist: singer, album })
    }
    return
  }

  if (mode == 'car') {
    // 车载歌词（最高）：只写 ucar 字段，title=当前歌词行，不写标准 TITLE/ARTIST
    void updateNowPlayingTitles({ title: lrc, artist: singer, album, carMode: true })
  } else {
    // 完整蓝牙歌词 / 蓝牙歌词：走标准逐句（title=歌词行，artist=歌名-歌手）
    void updateNowPlayingTitles({
      title: lrc,
      artist: `${name}${singer ? ` - ${singer}` : ''}`,
      album,
    })
  }
}

export default async(setting: LX.AppSetting) => {
  await initLyricPlayer()
  await Promise.all([
    setPlaybackRate(setting['player.playbackRate']),
    toggleTranslation(setting['player.isShowLyricTranslation']),
    toggleRoma(setting['player.isShowLyricRoma']),
  ])

  if (setting['desktopLyric.enable']) {
    showDesktopLyric().catch(() => {
      updateSetting({ 'desktopLyric.enable': false })
    })
  }
  setLyricSendState()
  onDesktopLyricPositionChange(position => {
    updateSetting({
      'desktopLyric.position.x': position.x,
      'desktopLyric.position.y': position.y,
    })
  })
  onLyricLinePlay(({ text, extendedLyrics }) => {
    if (!text && !playerState.isPlay) {
      void updateRemoteLyric()
    } else {
      void updateRemoteLyric(text)
    }
  })


  global.app_event.on('play', play)
  global.app_event.on('pause', pause)
  global.app_event.on('stop', stop)
  global.app_event.on('error', pause)
  global.app_event.on('musicToggled', stop)
  global.app_event.on('lyricUpdated', setLyric)
}
