import { compareVer } from '@/utils'
import { getOtaInfo, downloadOta } from '@/utils/ota'
import versionActions from '@/store/version/action'
import versionState, { type InitState } from '@/store/version/state'
import { getIgnoreVersion, saveIgnoreVersion } from '@/utils/data'
import { showVersionModal } from '@/navigation'
import { Navigation } from 'react-native-navigation'
import { toast } from '@/utils/tools'
import { version as currentVersion, versionCode as currentVersionCode } from '../../package.json'

export const showModal = () => {
  if (versionState.showModal) return
  versionActions.setVisibleModal(true)
  showVersionModal()
}

export const hideModal = (componentId: string) => {
  if (!versionState.showModal) return
  versionActions.setVisibleModal(false)
  void Navigation.dismissOverlay(componentId)
}

export const checkUpdate = async() => {
  versionActions.setVersionInfo({ status: 'checking' })
  let versionInfo: InitState['versionInfo'] = { ...versionState.versionInfo }
  try {
    // 本 fork 使用自定义 OTA（ota/update.json），不再请求上游 LX 的 version.json
    const info = await getOtaInfo()
    versionInfo.newVersion = {
      version: info.version,
      desc: info.changelog ?? '',
      history: [],
      apkUrl: info.apkUrl,
    }
    versionInfo.isUnknown = false
    versionInfo.status = 'idle'
    // 用 versionCode 判断是否最新（versionName 固定不变，用字符串会永远判定有新版）
    versionInfo.isLatest = info.versionCode != null
      ? (currentVersionCode ?? 0) >= info.versionCode
      : compareVer(currentVersion, info.version) != -1
  } catch (err) {
    versionInfo.newVersion = null
    versionInfo.isUnknown = true
    versionInfo.isLatest = false
    versionInfo.status = 'error'
  }

  versionActions.setVersionInfo(versionInfo)

  if (versionInfo.isLatest) {
    toast('已经是最新版本')
  } else if (!versionInfo.isUnknown && versionInfo.newVersion?.version != await getIgnoreVersion()) {
    showModal()
  }
}

export const downloadUpdate = () => {
  const apkUrl = versionState.versionInfo.newVersion?.apkUrl
  if (!apkUrl) {
    versionActions.setVersionInfo({ status: 'error' })
    return
  }
  // 走自定义 OTA 下载（自带进度提示与失败兜底），不再用上游 downloadNewVersion
  void downloadOta(apkUrl)
}


export const setIgnoreVersion = (version: InitState['ignoreVersion']) => {
  versionActions.setIgnoreVersion(version)
  saveIgnoreVersion(version)
}
