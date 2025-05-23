// src/pages/user/feedback/index.jsx

import React, { useState, useEffect, definePageConfig } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Button, Textarea, Input, Image, Video } from '@tarojs/components';
import './index.scss'; // Ensure you have an index.scss for styling

// Define page configuration
definePageConfig({
  navigationBarTitleText: '反馈与申诉', // Set navigation bar title
});

// You need to get the authentication token from your global state, local storage, etc.
// This is a placeholder.
const getAuthToken = () => {
  // Example: return Taro.getStorageSync('authToken');
  // Replace with your actual authentication token retrieval logic
  console.warn("Auth token retrieval not implemented. Using dummy token.");
  return 'YOUR_ACTUAL_AUTH_TOKEN_HERE';
};
// --- End Configuration Constants ---

export default function FeedbackPage() {
  // State for form fields
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [orderContext, setOrderContext] = useState(null); // To store order data passed as params
  const [media, setMedia] = useState([]); // State to store selected media files ({tempFilePath, size, fileType})
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Access navigation parameters (e.g., from order page for disputes)
  useEffect(() => {
    const { params } = Taro.getCurrentInstance().router;

    if (params) {
      if (params.context === 'order_dispute') {
        setSubject(params.subject || '');
        setMessage(params.initialMessage || '');
        setOrderContext({
          orderId: params.orderId,
          orderName: params.orderName,
        });
      }
      // You can add other contexts here if needed for different types of feedback
    }
  }, []); // Run once on component mount

  // The phone number to display and call (existing feature)
  const customerServiceNumber = '19896317053';

  // Handler to make a phone call (existing feature)
  const callCustomerService = () => {
    Taro.makePhoneCall({
      phoneNumber: customerServiceNumber,
      success: (res) => {
        console.log('Make phone call success:', res);
      },
      fail: (err) => {
        console.error('Make phone call failed:', err);
        Taro.showToast({ title: '拨号失败', icon: 'none' }); // Inform user if dialing fails
      },
    });
  };

  // Helper function to upload individual files
  // This function corresponds to the pattern used in page/request/index.jsx
  // It will upload files to a separate media upload endpoint and return their paths/URLs.
  const uploadFiles = async (filesToUpload) => {
    const uploadedFilePaths = [];
    const authToken = getAuthToken(); // Get auth token dynamically

    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];
      try {
        // --- IMPORTANT: This URL should point to your dedicated media upload endpoint ---
        // Example: POST /api/upload/media
        // Your backend should use `multer.single('file')` or similar on this endpoint
        // and return the path/URL of the saved file in its response.
        const uploadResponse = await Taro.uploadFile({
          url: API_BASE_URL + `/api/upload/media`, // Dedicated media upload endpoint
          filePath: file.tempFilePath,
          name: 'file', // Field name expected by your backend's file upload middleware (e.g., upload.single('file'))
          header: {
            'Authorization': `Bearer ${authToken}`, // Include auth token
            // 'Content-Type': 'multipart/form-data' is set automatically by Taro.uploadFile
          },
          // You can add other form data if needed for the upload endpoint (e.g., userId, fileType)
          formData: {
            fileType: file.fileType, // Pass fileType for backend processing
            // userId: yourUserId, // If your upload endpoint needs user context
          },
        });

        const responseData = JSON.parse(uploadResponse.data); // Parse string response from backend

        if (uploadResponse.statusCode === 200 || uploadResponse.statusCode === 201) {
          // Assuming your backend returns the uploaded file's path/URL in the response (e.g., { filePath: '/uploads/abc.jpg' } or { url: 'https://cdn.example.com/abc.jpg' })
          if (responseData.filePath) {
            uploadedFilePaths.push(responseData.filePath);
          } else if (responseData.url) { // For cloud storage scenarios
            uploadedFilePaths.push(responseData.url);
          } else {
            console.warn('Upload successful but no filePath/url returned in response:', responseData);
            Taro.showToast({ title: '文件上传成功但路径未知', icon: 'none' });
          }
        } else {
          console.error(`File upload failed for ${file.tempFilePath}:`, responseData);
          Taro.showToast({
            title: `文件上传失败: ${responseData.message || '未知错误'}`,
            icon: 'none',
            duration: 2000,
          });
          // Decide whether to throw an error or continue with other files
          throw new Error(`File upload failed for ${file.tempFilePath}`);
        }
      } catch (error) {
        console.error('Error during file upload:', error);
        Taro.showToast({
          title: '文件上传异常，请稍后再试',
          icon: 'none',
          duration: 2000,
        });
        throw error; // Re-throw to be caught by handleSubmitFeedback
      }
    }
    return uploadedFilePaths;
  };

  // Handler for media file upload button click
  const handleMediaUpload = async () => {
    try {
      const maxFiles = 5; // Matches backend Multer limit for 'media' field
      if (media.length >= maxFiles) {
        Taro.showToast({ title: `最多只能上传 ${maxFiles} 个文件`, icon: 'none' });
        return;
      }

      const res = await Taro.chooseMedia({
        count: maxFiles - media.length, // Only allow choosing remaining slots
        mediaType: ['image', 'video'],
        sourceType: ['album', 'camera'],
        maxDuration: 30, // Max video duration in seconds
        camera: 'back',
      });

      if (res.tempFiles && res.tempFiles.length > 0) {
        console.log('Selected media files:', res.tempFiles);
        const newMediaItems = res.tempFiles.map(file => ({
          tempFilePath: file.tempFilePath,
          size: file.size,
          fileType: file.fileType, // 'image' or 'video'
        }));
        setMedia(prevMedia => [...prevMedia, ...newMediaItems]);
        Taro.showToast({
          title: `${res.tempFiles.length} file(s) selected`,
          icon: 'success',
          duration: 1000
        });
      } else {
        console.log('No media files selected.');
      }
    } catch (error) {
      console.error('Error choosing media:', error);
      if (error.errMsg && error.errMsg.includes('cancel')) {
        console.log('Media selection canceled by user.');
      } else {
        Taro.showToast({
          title: 'Failed to select media',
          icon: 'none',
          duration: 2000
        });
      }
    }
  };

  // Handler to remove a media file from the selected list
  const handleRemoveMedia = (indexToRemove) => {
    console.log('Removing media file at index:', indexToRemove);
    setMedia(media.filter((_, index) => index !== indexToRemove));
    Taro.showToast({ title: 'Media removed', icon: 'none', duration: 1000 });
  };

  // Handler for submitting feedback/dispute
  const handleSubmitFeedback = async () => {
    if (!subject.trim() || !message.trim()) {
      Taro.showToast({ title: '主题和内容不能为空', icon: 'none' });
      return;
    }

    setIsSubmitting(true);
    Taro.showLoading({ title: '提交中...' });

    try {
      let uploadedAttachmentPaths = [];
      if (media.length > 0) {
        console.log("Uploading media files for feedback...");
        // Use the uploadFiles helper function
        uploadedAttachmentPaths = await uploadFiles(media); // Pass the 'media' state array
        console.log("Media files uploaded and paths collected:", uploadedAttachmentPaths);
      }

      const requestData = {
        subject,
        message,
        type: orderContext ? 'order_dispute' : 'general_feedback', // Determine type based on context
        orderId: orderContext ? orderContext.orderId : null, // Pass orderId if dispute, otherwise null
        attachments: uploadedAttachmentPaths, // Include the paths/URLs of pre-uploaded files
      };

      const authToken = getAuthToken(); // Get auth token dynamically

      // --- IMPORTANT: This backend endpoint must NOT use Multer's `upload.array` ---
      // It should expect a JSON body with an 'attachments' array of strings.
      const response = await Taro.request({
        url: API_BASE_URL + '/api/user/feedback', // Your backend endpoint for feedback submission
        method: 'POST',
        header: {
          'Content-Type': 'application/json', // Always JSON, as files are pre-uploaded
          'Authorization': `Bearer ${authToken}`, // Include auth token
        },
        data: requestData,
      });

      if (response.statusCode === 200 || response.statusCode === 201) {
        Taro.showToast({ title: '提交成功', icon: 'success' });
        // Clear form fields and media after successful submission
        setSubject('');
        setMessage('');
        setMedia([]);
        setOrderContext(null); // Clear order context if it was a dispute

        setTimeout(() => {
          Taro.navigateBack(); // Navigate back to previous page
        }, 1500);
      } else {
        const errorMessage = response.data && response.data.message ? response.data.message : `提交失败: ${response.statusCode}`;
        Taro.showToast({ title: errorMessage, icon: 'none' });
        console.error('Feedback submission failed:', response);
      }
    } catch (error) {
      console.error('Error submitting feedback:', error);
      Taro.showToast({ title: '提交失败，请稍后再试', icon: 'none' });
    } finally {
      Taro.hideLoading();
      setIsSubmitting(false);
    }
  };

  return (
    <View className="feedback-page">
      <Text className="title">反馈与申诉</Text>
      <Text className="description">如果您有任何问题或建议，请填写以下表格：</Text>

      {/* Display order context if available (for dispute cases) */}
      {orderContext && orderContext.orderId && (
        <View className="order-context-info">
          <Text>关联订单: <Text className="order-id">{orderContext.orderId}</Text></Text>
          {orderContext.orderName && <Text>订单名称: <Text className="order-name">{orderContext.orderName}</Text></Text>}
        </View>
      )}

      <View className="form-section">
        <Text className="label">主题:</Text>
        <Input
          className="input-field"
          placeholder="请输入主题"
          value={subject}
          onInput={(e) => setSubject(e.detail.value)}
          disabled={isSubmitting}
        />

        <Text className="label">内容:</Text>
        <Textarea
          className="textarea-field"
          placeholder="请详细描述您遇到的问题或建议"
          value={message}
          onInput={(e) => setMessage(e.detail.value)}
          maxlength={500} // Character limit
          showConfirmBar={true} // Show confirm bar for mobile keyboards
          autoHeight // Auto adjust height based on content
          disabled={isSubmitting}
        />

        {/* Media Upload Section */}
        <View className="media-upload-section">
          <Text className="label">上传附件 (最多 {5 - media.length} 个文件):</Text>
          <Button
            className="upload-button"
            onClick={handleMediaUpload}
            disabled={isSubmitting || media.length >= 5} // Disable if submitting or max files reached
          >
            {media.length > 0 ? '选择更多文件' : '选择图片/视频'}
          </Button>

          {media.length > 0 && (
            <View className="uploaded-files-preview">
              {media.map((item, index) => (
                <View key={index} className="media-item-container">
                  {item.fileType === 'image' ? (
                    <Image
                      className="media-thumbnail"
                      src={item.tempFilePath}
                      mode="aspectFill"
                      onClick={() => Taro.previewImage({ current: item.tempFilePath, urls: media.filter(m => m.fileType === 'image').map(m => m.tempFilePath) })}
                    />
                  ) : (
                    <Video
                      className="media-thumbnail"
                      src={item.tempFilePath}
                      controls={false} // Optional: hide controls to show thumbnail
                      showPlayBtn={true} // Show play button on video thumbnail
                      objectFit="cover"
                    // For actual video playback, consider showing a dedicated player in a modal
                    />
                  )}
                  <Button
                    className="remove-media-button"
                    onClick={() => handleRemoveMedia(index)}
                    size="mini"
                    disabled={isSubmitting}
                  >
                    X
                  </Button>
                </View>
              ))}
            </View>
          )}
        </View>

        <Button className="submit-button" onClick={handleSubmitFeedback} disabled={isSubmitting}>
          {isSubmitting ? '提交中...' : '提交反馈'}
        </Button>
      </View>

      <View className="divider" />

      {/* Existing contact method (phone call) */}
      <View className="contact-method-section">
        <Text className="section-title">紧急联系方式</Text>
        <Text className="contact-description">对于紧急事务，您也可以直接拨打客服电话：</Text>
        <View className="contact-info">
          <Text>客服电话:</Text>
          <Text className="phone-number">{customerServiceNumber}</Text>
        </View>
        <Button className="call-button" onClick={callCustomerService}>
          直接拨打电话
        </Button>
      </View>
    </View>
  );
}
