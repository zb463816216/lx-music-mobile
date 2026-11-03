import { NativeModules } from 'react-native'

const { CarModeModule } = NativeModules

export interface CarAudioOutput {
  type: string
  productName: string
}
export interface CarUsbDevice {
  deviceName: string
  vendorId: number
  productId: number
  manufacturerName: string
  productName: string
}
export interface CarBtDevice {
  name: string
  address: string
}
export interface CarDiagnostics {
  /** Configuration.UI_MODE_TYPE_*，3 = CAR */
  uiMode: number
  isCarMode: boolean
  audioOutputs: CarAudioOutput[]
  hasUsbAudio: boolean
  hasA2dp: boolean
  hasDock: boolean
  usbDevices: CarUsbDevice[]
  btBonded: CarBtDevice[]
  btError: string
  plugged?: number
  isCharging?: boolean
  model: string
  manufacturer: string
  sdkInt: number
}

export const isCarModeModuleAvailable = (): boolean => !!CarModeModule

export const getCarDiagnostics = async(): Promise<CarDiagnostics> => {
  return CarModeModule.getDiagnostics()
}
