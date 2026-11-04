import { httpGet } from '@/utils/request'
import { downloadFile, temporaryDirectoryPath } from '@/utils/fs'
import { installApk } from '@/utils/nativeModules/utils'
import { APP_PROVIDER_NAME, OTA_VERSION_URL } from '@/config/constant'
import { confirmDialog, toast, openUrl } from '@/utils/tools'
import { compareVer } from '@/utils'
import settingState from '@/store/setting/state'
// 读取本应用自身版本号/构建号，用于与远端比较
import { version as currentVersion, versionCode as currentVersionCode } from '../../package.json'
import type { OtaInfo } from '@/types/ota'

// 多镜像容错：主用 raw.githubusercontent，备用 jsdelivr CDN
const mirrors: string[] = [
  OTA_VERSION_URL,
  OTA_VERSION_URL
    .replace('raw.githubusercontent.com', 'cdn.jsdelivr.net/gh')
    .replace('/jovi-dev/', '@jovi-dev/'),
]

const requestText = (url: string) =>
  new Promise<unknown>((resolve, reject) => {
    httpGet(url, { timeout: 10000 }, (err, resp, body) => {
      if (err || resp?.statusCode !== 200) reject(err ?? new Error('HTTP ' + (resp?.statusCode ?? '?')))
      else resolve(body)
    })
  })

export const getOtaInfo = async(index = 0): Promise<OtaInfo> => {
  if (index >= mirrors.length) throw new Error('OTA: 无法获取更新信息')
  try {
    const raw = await requestText(mirrors[index])
    // 注意：request.js 的 fetchData 会把合法 JSON 的 body 自动 parse 成对象，
    // 这里必须兼容「对象 / 字符串」两种形态，否则对对象再 JSON.parse 会抛错导致永远失败
    const info = (typeof raw === 'string' ? JSON.parse(raw) : raw) as OtaInfo
    if (!info?.version || !info?.apkUrl) throw new Error('OTA: 数据异常')
    return info
  } catch (err) {
    return getOtaInfo(index + 1)
  }
}

/**
 * 检查 OTA 更新。
 * @param silent 为 true 时（启动自动检查）受「自动检查更新」开关控制；手动检查请传 false。
 */
export const checkOta = async(silent = false) => {
  if (silent && !settingState.setting['common.otaAutoCheck']) return
  if (!silent) toast('检查更新中…')
  let info: OtaInfo
  try {
    info = await getOtaInfo()
  } catch {
    if (!silent) toast('检查更新失败')
    return
  }
  // 优先用 versionCode 比较：versionName 固定为包版本不变，若用版本字符串会永远判定"有新版本"，
  // 导致更新装完后仍反复提示更新。versionCode 每次构建 +1，且已随 JS 打进包里。
  const isLatest = info.versionCode != null
    ? (currentVersionCode ?? 0) >= info.versionCode
    : compareVer(currentVersion, info.version) !== -1
  if (isLatest) {
    if (!silent) toast('已经是最新版本')
    return
  }
  const ok = await confirmDialog({
    title: `发现新版本 ${info.version}`,
    message: info.changelog || '是否前往下载并安装？',
    confirmButtonText: '更新',
    cancelButtonText: '取消',
  })
  if (!ok) return
  await downloadOta(info.apkUrl)
}

export const downloadOta = async(apkUrl: string) => {
  const savePath = temporaryDirectoryPath + '/salt-ota.apk'
  toast('开始下载更新…')
  try {
    await new Promise<void>((resolve, reject) => {
      const { promise } = downloadFile(apkUrl, savePath, {
        progressInterval: 500,
        connectionTimeout: 20000,
        readTimeout: 30000,
        begin() {},
        progress() {},
      })
      promise.then(() => resolve()).catch(reject)
    })
  } catch (err) {
    // 国内直连 GitHub Releases 常失败：兜底让用户用浏览器下载
    const ok = await confirmDialog({
      title: '下载失败',
      message: `可能网络无法访问 GitHub（请检查代理/网络）。\n${(err as Error)?.message ?? String(err)}\n\n是否改用浏览器打开下载链接？`,
      confirmButtonText: '浏览器下载',
      cancelButtonText: '取消',
    })
    if (ok) void openUrl(apkUrl)
    return
  }
  toast('下载完成，正在安装…')
  try {
    // 复用应用内置的 FileProvider（authority = com.salt.music.provider）安装 APK
    await installApk(savePath, APP_PROVIDER_NAME)
  } catch (err) {
    const ok = await confirmDialog({
      title: '安装失败',
      message: `请确认已允许本应用「安装未知应用」权限。\n${(err as Error)?.message ?? String(err)}\n\n是否改用浏览器下载？`,
      confirmButtonText: '浏览器下载',
      cancelButtonText: '取消',
    })
    if (ok) void openUrl(apkUrl)
  }
}
