import React from 'react';
import { View, Text, Image, Button } from '@tarojs/components';

const MediaUploader = ({
  media,
  onUpload,
  onRemove,
  isSubmitting
}) => {
  return (
    <View className="media-upload-section">
      <Button 
        onClick={onUpload}
        disabled={isSubmitting || media.length >= 5}
      >
        上传图片/视频
      </Button>

      {media.length > 0 && (
        <View className="selected-media-previews">
          <Text className="section-title">已选择的媒体文件 ({media.length})</Text>
          <View className="previews-container">
            {media.map((file, index) => (
              <View key={file.tempFilePath || index} className="media-preview-item">
                {file.fileType === 'image' ? (
                  <Image 
                    src={file.tempFilePath} 
                    className="media-thumbnail" 
                    mode="aspectFill" 
                  />
                ) : (
                  <View className="media-thumbnail video-placeholder">视频</View>
                )}
                <View 
                  className="remove-media-button" 
                  onClick={() => onRemove(index)}
                >
                  <Text className="remove-icon">×</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
};

export default MediaUploader; 