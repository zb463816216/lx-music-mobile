export interface OtaInfo {
  /** 新版本号（仅用于展示），versionName 固定为包版本，不参与比较 */
  version: string
  /** 新版本 versionCode，用于与本地比较。缺省时回退为 version 字符串比较 */
  versionCode?: number
  /** 新版本 APK 直链（GitHub Releases / 自建静态托管均可） */
  apkUrl: string
  /** 更新日志 / 提示文案 */
  changelog?: string
  /** 是否强制更新（预留，当前实现不强制） */
  force?: boolean
}
