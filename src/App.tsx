import type { ExifParamsForm } from './types'
import { createFromIconfontCN, DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Divider, Flex, Form, Input, Select, Slider, Space, Switch, Tooltip, Typography, Upload } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useImageHandlers } from './hooks/useImageHandlers'

import { BrandsList, getBrandUrl } from './utils/BrandUtils.ts'
import {
  DefaultPictureExif,
  getRandomImage,
  parseExifData,
} from './utils/ImageUtils'
import init, { get_exif } from './wasm/gen_brand_photo_pictrue'

import './styles/App.css'

export const IconFont = createFromIconfontCN({
  scriptUrl: [
    '//at.alicdn.com/t/c/font_4757469_kkotyy5658l.js', // icon-apple, icon-jianeng, icon-DJI, icon-fushi, icon-huawei1, icon-laika, icon-icon-xiaomiguishu, icon-nikon, icon-sony
  ],
})

function App() {
  const formRef = useRef()
  const { imgRef, imgUrl, setImgUrl, formValue, setFormValue, handleAdd, handleDownload, handleFormChange, handleFontSizeChange, handleFontWeightChange, handleFontFamilyChange, handleScaleChange, handleExhibitionClick } = useImageHandlers(formRef, DefaultPictureExif)
  const [wasmLoaded, setWasmLoaded] = useState(false)
  const [exifEnable, setExifEnable] = useState(false)

  const formValueRef = useRef<ExifParamsForm>(DefaultPictureExif)

  useEffect(() => {
    const loadWasm = async () => {
      await init()
      setWasmLoaded(true)
    }
    loadWasm()
  }, [])

  // 在组件加载时随机选择一张照片并解析其 EXIF 数据
  useEffect(() => {
    const loadImageAndParseExif = async () => {
      const randomImg = getRandomImage()
      const img = new Image()
      img.src = randomImg

      img.onload = async () => {
        const response = await fetch(randomImg)
        const blob = await response.blob()
        const arrayBuffer = await blob.arrayBuffer()
        const exifData = get_exif(new Uint8Array(arrayBuffer))
        const parsedExif = parseExifData(exifData)

        setImgUrl(randomImg)
        if (imgRef.current) {
          imgRef.current.classList.add('loaded')
        }
        const updatedFormValue = {
          ...formValueRef.current,
          ...parsedExif,
          brand_url: getBrandUrl(parsedExif.brand),
        }
        formRef.current.setFieldsValue(updatedFormValue)
        setFormValue(updatedFormValue)
        formValueRef.current = updatedFormValue
      }
    }
    loadImageAndParseExif()
  }, [wasmLoaded, imgRef, setImgUrl, setFormValue])

  if (!wasmLoaded) {
    return <div>Loading WASM...</div>
  }

  return (
    <>
      <Typography.Title level={2} className="picseal-title">PICSEAL</Typography.Title>
      <Divider />
      <Typography.Text className="picseal-description">小米照片风格水印照片，支持佳能、尼康、索尼、苹果、华为、小米、大疆。</Typography.Text>
      <div className="preview-box">
        <Typography.Title level={4}>预览</Typography.Title>
        <div className="preview" id="preview">
          <img ref={imgRef} className="preview-picture" src={imgUrl} alt="Preview" />
          <div className="preview-info">
            <div className="preview-info-left">
              <div className="preview-info-model">{formValue.model}</div>
              <div className="preview-info-date">{formValue.date}</div>
              <div className="preview-info-brand">
                <img src={formValue.brand_url} alt="Brand" />
              </div>
            </div>
            <div className="preview-info-split"></div>
            <div className="preview-info-right">
              <div className="preview-info-device">{formValue.device}</div>
              <div className="preview-info-gps">{formValue.gps}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="exhibition">
        <Flex wrap gap="middle" horizontal="true" justify="center" align="center">
          <Button type="primary" shape="round" size="default" ghost onClick={() => handleExhibitionClick('apple')}>
            <IconFont type="icon-apple" style={{ fontSize: '16px' }} />
            Apple
          </Button>
          <Button type="primary" shape="round" size="default" ghost onClick={() => handleExhibitionClick('canon')}>
            <IconFont type="icon-jianeng" style={{ fontSize: '28px' }} />
            Cannon
          </Button>
          <Button type="primary" shape="round" size="default" ghost onClick={() => handleExhibitionClick('dji')}>
            <IconFont type="icon-DJI" style={{ fontSize: '28px' }} />
            Dji
          </Button>
          <Button type="primary" shape="round" size="default" ghost onClick={() => handleExhibitionClick('fujifilm')}>
            <IconFont type="icon-fushi" style={{ fontSize: '28px' }} />
            Fuji
          </Button>
          <Button type="primary" shape="round" size="default" ghost onClick={() => handleExhibitionClick('huawei')}>
            <IconFont type="icon-huawei1" style={{ fontSize: '16px' }} />
            Huawei
          </Button>
          <Button type="primary" shape="round" size="default" ghost onClick={() => handleExhibitionClick('leica')}>
            <IconFont type="icon-laika" style={{ fontSize: '16px' }} />
            Leica
          </Button>
          <Button type="primary" shape="round" size="default" ghost onClick={() => handleExhibitionClick('xiaomi')}>
            <IconFont type="icon-icon-xiaomiguishu" style={{ fontSize: '16px' }} />
            Xiaomi
          </Button>
          <Button type="primary" shape="round" size="default" ghost onClick={() => handleExhibitionClick('nikon')}>
            <IconFont type="icon-nikon" style={{ fontSize: '16px' }} />
            Nikon
          </Button>
          <Button type="primary" shape="round" size="default" ghost onClick={() => handleExhibitionClick('sony')}>
            <IconFont type="icon-sony" style={{ fontSize: '28px' }} />
            Sony
          </Button>
          <Button type="primary" shape="round" size="default" ghost onClick={() => handleExhibitionClick('panasonic')}>
            <IconFont type="icon-panasonic" style={{ fontSize: '36px' }} />
            Panasonic
          </Button>
          <Button type="primary" shape="round" size="default" ghost onClick={() => handleExhibitionClick('ricoh')}>
            <IconFont type="icon-ricoh" style={{ fontSize: '28px' }} />
            Ricoh
          </Button>
          <Button type="primary" shape="round" size="default" ghost onClick={() => handleExhibitionClick('olympus')}>
            <IconFont type="icon-olympus" style={{ fontSize: '36px' }} />
            Olympus
          </Button>
          <Button type="primary" shape="round" size="default" ghost onClick={() => handleExhibitionClick('insta360')}>
            <IconFont type="icon-insta360" style={{ fontSize: '46px' }} />
            Insta360
          </Button>
        </Flex>
      </div>

      <div className="op">
        <Space size="large">
          <Upload
            accept="image/*"
            beforeUpload={(file) => {
              handleAdd(file)
              return false
            }}
            fileList={[]}
          >
            <Button type="primary" shape="round" icon={<PlusOutlined />} ghost>
              新建照片
            </Button>
          </Upload>
          <Button
            type="primary"
            shape="round"
            icon={<DownloadOutlined />}
            onClick={() => handleDownload(exifEnable)}
          >
            导出照片
          </Button>
        </Space>

      </div>

      <div className="props">
        <div className="props-title">
          <Typography.Title level={4}>参数</Typography.Title>
        </div>
        <div className="props-option">
          <Flex wrap gap="small" horizontal="true" justify="flex-start" align="center">
            <Typography.Text className="switch-title">导出 EXIF</Typography.Text>
            <Tooltip placement="topLeft" title="实验性功能：嵌入原图 EXIF 信息至导出图片，只支持 JPEG">
              <Switch
                defaultChecked={exifEnable}
                onClick={() => setExifEnable(!exifEnable)}
              />
            </Tooltip>
          </Flex>
          <Form
            ref={formRef}
            labelCol={{ span: 4 }}
            wrapperCol={{ span: 14 }}
            layout="horizontal"
            size="small"
            style={{ maxWidth: 800 }}
            initialValues={formValue}
            onValuesChange={handleFormChange}
          >
            <Form.Item label="横幅大小" name="scale">
              <Slider
                min={0.5}
                max={1.2}
                step={0.1}
                onChange={handleScaleChange}
              />
            </Form.Item>
            <Form.Item label="相机型号" name="model">
              <Input />
            </Form.Item>
            <Form.Item label="相机品牌" name="brand">
              <Select style={{ width: 170 }}>
                {BrandsList.map(brand => (
                  <Select.Option key={brand} value={brand.toLowerCase()}>
                    {brand}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label="拍摄参数" name="device">
              <Input />
            </Form.Item>
            <Form.Item label="拍摄时间" name="date">
              <Input />
            </Form.Item>
            <Form.Item label="拍摄地点" name="gps">
              <Input />
            </Form.Item>
            <Form.Item label="字体大小" name="fontSize">
              <Select style={{ width: 170 }} onChange={handleFontSizeChange}>
                <Select.Option value="small">小</Select.Option>
                <Select.Option value="normal">正常</Select.Option>
                <Select.Option value="large">大</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item label="字体粗细" name="fontWeight">
              <Select style={{ width: 170 }} onChange={handleFontWeightChange}>
                <Select.Option value="normal">正常</Select.Option>
                <Select.Option value="bold">加粗</Select.Option>
                <Select.Option value="black">黑体</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item label="字体" name="fontFamily">
              <Select style={{ width: 170 }} onChange={handleFontFamilyChange}>
                <Select.Option value="default">Default</Select.Option>
                <Select.Option value="misans">MiSans</Select.Option>
                <Select.Option value="caveat">Caveat</Select.Option>
                <Select.Option value="helvetica">Helvetica Neue</Select.Option>
                <Select.Option value="futura">Futura</Select.Option>
                <Select.Option value="avenir">Avenir</Select.Option>
                <Select.Option value="didot">Didot</Select.Option>
              </Select>
            </Form.Item>
          </Form>
        </div>
      </div>
    </>
  )
}

export default App
