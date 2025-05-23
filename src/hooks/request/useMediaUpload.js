import { useState } from 'react';
import Taro from '@tarojs/taro';

const useMediaUpload = () => {
  const [media, setMedia] = useState([]);

  const resetMedia = () => {
    setMedia([]);
  };

  const handleMediaUpload = async () => {
    try {
      const res = await Taro.chooseMedia({
        count: 5 - media.length,
        mediaType: ['image', 'video'],
        sourceType: ['album', 'camera'],
        maxDuration: 30,
        camera: 'back',
      });

      if (res.tempFiles && res.tempFiles.length > 0) {
        const newMediaItems = res.tempFiles.map(file => ({
          tempFilePath: file.tempFilePath,
          size: file.size,
          fileType: file.fileType,
        }));
        setMedia(prevMedia => [...prevMedia, ...newMediaItems]);
        Taro.showToast({
          title: `${res.tempFiles.length} file(s) selected`,
          icon: 'success',
          duration: 1000
        });
      }
    } catch (error) {
      if (!error.errMsg?.includes('cancel')) {
        Taro.showToast({
          title: 'Failed to select media',
          icon: 'none',
          duration: 2000
        });
      }
    }
  };

  const handleRemoveMedia = (indexToRemove) => {
    setMedia(media.filter((_, index) => index !== indexToRemove));
    Taro.showToast({ 
      title: 'Media removed', 
      icon: 'none', 
      duration: 1000 
    });
  };

  const uploadFiles = async (resourceId = null) => {
    const uploadedMediaNames = [];
    const authToken = Taro.getStorageSync('authToken');

    if (!authToken) {
      throw new Error("Authentication token missing for file upload.");
    }

    const uploadEndpoint = API_BASE_URL + '/api/resource/upload-media';

    for (const file of media) {
      try {
        const fileUploadRes = await Taro.uploadFile({
          url: uploadEndpoint,
          filePath: file.tempFilePath,
          name: 'media',
          header: {
            'Authorization': `Bearer ${authToken}`,
          },
        });

        if (fileUploadRes.statusCode >= 200 && fileUploadRes.statusCode < 300) {
          let fileResData;
          try {
            fileResData = typeof fileUploadRes.data === 'string' 
              ? JSON.parse(fileUploadRes.data) 
              : fileUploadRes.data;
          } catch (parseErr) {
            console.error("Failed to parse file upload response JSON:", parseErr);
            fileResData = { filePath: file.tempFilePath.split('/').pop() || 'uploaded_file' };
          }

          if (fileResData?.filePath) {
            uploadedMediaNames.push(fileResData.filePath);
          } else {
            uploadedMediaNames.push(file.tempFilePath.split('/').pop() || 'uploaded_file_no_path');
          }
        } else {
          throw new Error(`Upload failed with status ${fileUploadRes.statusCode}`);
        }
      } catch (fileErr) {
        console.error('Error during file upload:', fileErr);
        throw fileErr;
      }
    }
    return uploadedMediaNames;
  };

  return {
    media,
    handleMediaUpload,
    handleRemoveMedia,
    uploadFiles,
    resetMedia
  };
};

export default useMediaUpload; 