import { memo } from 'react'
import { View, TouchableOpacity, Alert } from 'react-native'

import Section from '../components/Section'
// import Button from './components/Button'

import { createStyle, openUrl } from '@/utils/tools'
// import { showPactModal } from '@/navigation'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { showPactModal, updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import CheckBoxItem from '../components/CheckBoxItem'
import { checkOta } from '@/utils/ota'
import { getCarDiagnostics, isCarModeModuleAvailable } from '@/utils/nativeModules/carMode'

// const qqGroupUrl = 'mqqopensdkapi://bizAgent/qm/qr?url=http%3A%2F%2Fqm.qq.com%2Fcgi-bin%2Fqm%2Fqr%3Ffrom%3Dapp%26p%3Dandroid%26jump_from%3Dwebapi%26k%3Du1zyxek8roQAwic44nOkBXtG9CfbAxFw'
// const qqGroupUrl2 = 'mqqopensdkapi://bizAgent/qm/qr?url=http%3A%2F%2Fqm.qq.com%2Fcgi-bin%2Fqm%2Fqr%3Ffrom%3Dapp%26p%3Dandroid%26jump_from%3Dwebapi%26k%3D-l4kNZ2bPQAuvfCQFFhl1UoibvF5wcrQ'
// const qqGroupWebUrl = 'https://qm.qq.com/cgi-bin/qm/qr?k=jRZkyFSZ4FmUuTHA3P_RAXbbUO_Rrn5e&jump_from=webapi'
// const qqGroupWebUrl2 = 'https://qm.qq.com/cgi-bin/qm/qr?k=HPNJEfrZpBZ9T8szYWbe2d5JrAAeOt_l&jump_from=webapi'

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const openHomePage = () => {
    void openUrl('https://github.com/lyswhut/lx-music-mobile#readme')
  }
  const openIssuePage = () => {
    void openUrl('https://github.com/lyswhut/lx-music-mobile/issues?q=is%3Aissue+')
  }
  const openGHReleasePage = () => {
    void openUrl('https://github.com/lyswhut/lx-music-mobile/releases')
  }
  const openFAQPage = () => {
    void openUrl('https://lyswhut.github.io/lx-music-doc/mobile/faq')
  }
  // const openIssuesPage = () => {
  //   openUrl('https://github.com/lyswhut/lx-music-mobile/issues')
  // }
  const openPactModal = () => {
    showPactModal()
  }
  const openPartPage = () => {
    void openUrl('https://github.com/lyswhut/lx-music-mobile#%E9%A1%B9%E7%9B%AE%E5%8D%8F%E8%AE%AE')
  }
  const otaAutoCheck = useSettingValue('common.otaAutoCheck')
  const setOtaAutoCheck = (v: boolean) => updateSetting({ 'common.otaAutoCheck': v })
  const checkOtaNow = () => void checkOta(false)

  // 车载检测诊断：把系统车载模式/音频路由/USB/蓝牙名一次性打印出来，供真车实测判定
  const runCarDiag = async() => {
    if (!isCarModeModuleAvailable()) {
      Alert.alert('车载检测诊断', '当前安装包未包含诊断模块，请安装重新构建的 APK 后再试')
      return
    }
    try {
      const d = await getCarDiagnostics()
      const audio = d.audioOutputs.map(a => a.type).join(', ') || '无'
      const usb = d.usbDevices.length
        ? d.usbDevices.map(u => `${u.vendorId}:${u.productId} ${u.manufacturerName || ''}/${u.productName || ''}`.trim()).join('\n')
        : '无'
      const bt = d.btBonded.length
        ? d.btBonded.map(b => b.name || b.address).join('\n')
        : (d.btError || '无')
      const msg = [
        `系统车载模式: ${d.isCarMode ? '是' : '否'} (uiMode=${d.uiMode})`,
        `USB音频:${d.hasUsbAudio ? '有' : '无'}  蓝牙A2DP:${d.hasA2dp ? '有' : '无'}  Dock:${d.hasDock ? '有' : '无'}`,
        `插电充电: ${d.isCharging ? '是' : '否'}`,
        '',
        `音频输出: ${audio}`,
        '',
        `USB 设备(${d.usbDevices.length}):`,
        usb,
        '',
        `蓝牙已配对(${d.btBonded.length}):`,
        bt,
        '',
        `机型: ${d.manufacturer} ${d.model} · Android ${d.sdkInt}`,
      ].join('\n')
      console.log('[CarDiagnostics]', JSON.stringify(d, null, 2))
      Alert.alert('车载检测诊断', msg)
    } catch (e) {
      Alert.alert('车载检测诊断失败', String(e))
    }
  }

  // const goToQQGroup = () => {
  //   openUrl(qqGroupUrl).catch(() => {
  //     void openUrl(qqGroupWebUrl)
  //   })
  // }
  // const goToQQGroup2 = () => {
  //   openUrl(qqGroupUrl2).catch(() => {
  //     void openUrl(qqGroupWebUrl2)
  //   })
  // }

  const textLinkStyle = {
    ...styles.text,
    textDecorationLine: 'underline',
    color: theme['c-primary-font'],
    // fontSize: 14,
  } as const


  return (
    <Section title={t('setting_about')}>
      <View style={styles.part}>
        <Text style={styles.text} >本软件完全免费，代码已开源。开源地址：</Text>
        <TouchableOpacity onPress={openHomePage}>
          <Text style={textLinkStyle}>https://github.com/lyswhut/lx-music-mobile</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}>最新版下载地址：</Text>
        <TouchableOpacity onPress={openGHReleasePage}>
          <Text style={textLinkStyle}>GitHub Releases</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.part}>
        <Text style={styles.text} >软件的常见问题可转至：</Text>
        <TouchableOpacity onPress={openFAQPage}>
          <Text style={textLinkStyle}>移动版常见问题</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}><Text style={styles.boldText}>本软件没有客服</Text>，但我们整理了一些常见的使用问题。<Text style={styles.boldText} >仔细、仔细、仔细</Text>地阅读常见问题后，</Text>
        <Text style={styles.text}>仍有问题可到 GitHub </Text>
        <TouchableOpacity onPress={openIssuePage}>
          <Text style={textLinkStyle}>提交 Issue</Text>
        </TouchableOpacity>
        <Text style={styles.text}>。</Text>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}>由于软件开发的初衷仅是为了对新技术的学习与研究，因此软件直至停止维护都将会一直保持纯净。</Text>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}>目前本项目的原始发布地址<Text style={styles.boldText}>只有 GitHub</Text>，其他渠道均为第三方转载发布，可信度请自行鉴别。</Text>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}><Text style={styles.boldText}>本项目没有微信公众号之类的所谓「官方账号」，也未在小米、华为、vivo 等应用商店发布同名应用，谨防被骗！</Text></Text>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}>若你使用过程中遇到<Text style={styles.boldText}>广告</Text>或者<Text style={styles.boldText}>引流</Text>（如需要加群、关注公众号之类才能使用或者升级）的信息，则表明你当前运行的软件是「第三方修改版」。</Text>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}>若在升级新版本时提示「<Text style={styles.boldText}>签名不一致</Text>」，则表明你手机上的旧版本或者将要安装的新版本中<Text style={styles.boldText}>有一方</Text>是「<Text style={styles.boldText}>第三方修改版</Text>」。</Text>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}>你已签署本软件的</Text>
        <TouchableOpacity onPress={openPactModal}><Text style={styles.text} color={theme['c-primary-font']}>许可协议</Text></TouchableOpacity>
        <Text style={styles.text}>，协议的在线版本在</Text>
        <TouchableOpacity onPress={openPartPage}><Text style={textLinkStyle}>这里</Text></TouchableOpacity>
        <Text style={styles.text}>。</Text>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}>By: </Text>
        <Text style={styles.text}>落雪无痕</Text>
      </View>
      <View style={styles.part}>
        <TouchableOpacity onPress={checkOtaNow}>
          <Text style={textLinkStyle}>{t('setting_check_update')}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.part}>
        <CheckBoxItem check={otaAutoCheck} onChange={setOtaAutoCheck} label={t('setting_ota_auto_check')} />
      </View>
      <View style={styles.part}>
        <TouchableOpacity onPress={runCarDiag}>
          <Text style={textLinkStyle}>车载检测诊断</Text>
        </TouchableOpacity>
      </View>
    </Section>
  )
})

const styles = createStyle({
  part: {
    marginLeft: 15,
    marginRight: 15,
    marginBottom: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  text: {
    fontSize: 14,
    textAlignVertical: 'bottom',
  },
  boldText: {
    fontSize: 14,
    fontWeight: 'bold',
    textAlignVertical: 'bottom',
  },
  throughText: {
    fontSize: 14,
    textDecorationLine: 'line-through',
    textAlignVertical: 'bottom',
  },
  btn: {
    flexDirection: 'row',
  },
})
