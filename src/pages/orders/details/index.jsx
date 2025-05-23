// In frontend/src/pages/orders/details/index.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Button, ScrollView, Input, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './index.scss';

// Helper to display resource media (reused from OrderComponent concept)
const displayItemMedia = (item, className = "item-media-detail") => {
  if (!item) return null;

  let mediaToDisplay = null;

  if (item.type === 'resource' && item.media && item.media.length > 0) {
    mediaToDisplay = item.media[0];
  } else if (item.type === 'match') {
    mediaToDisplay = item.resource1?.media?.[0];
  } else if (item.type === 'errand') {
    mediaToDisplay = item.resourceRequestId?.media?.[0];
  }

  if (!mediaToDisplay) return null;

  const imageUrl = mediaToDisplay.url || mediaToDisplay.filePath;
  const fullMediaUrl = imageUrl ?
    (imageUrl.startsWith('http') ? imageUrl : API_BASE_URL + `/media/${imageUrl}`) :
    'placeholder.jpg';

  return (
    <View className={className}>
      {mediaToDisplay.type === 'image' ? (
        <Image src={fullMediaUrl} className="media-thumbnail" mode="aspectFill" />
      ) : (
        <Text>[视频]</Text>
      )}
    </View>
  );
};

export default function OrderDetailPage() {
  const [itemId, setItemId] = useState(null);
  const [itemType, setItemType] = useState(null);
  const [itemData, setItemData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);

  const handleAuthError = useCallback(() => {
    Taro.removeStorageSync('authToken');
    Taro.removeStorageSync('userId');
    Taro.showToast({ title: '认证失败，请重新登录', icon: 'none', duration: 2000 });
    setTimeout(() => {
      Taro.redirectTo({ url: '/pages/user/login' });
    }, 2000);
  }, []);

  const callUpdateStatusApi = useCallback(async (endpoint, data = {}, method = 'PUT') => {
    if (isUpdatingStatus) return;

    setIsUpdatingStatus(true);
    const authToken = Taro.getStorageSync('authToken');
    if (!authToken) {
      console.warn('No auth token for update.');
      handleAuthError();
      setIsUpdatingStatus(false);
      return;
    }

    try {
      const response = await Taro.request({
        url: endpoint,
        method: method,
        data: data,
        header: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      });

      if (response.statusCode >= 200 && response.statusCode < 300) {
        Taro.showToast({ title: "状态更新成功", icon: "success", duration: 1500 });
        await fetchItemDetails(itemId, itemType, authToken);
        return true;
      } else if (response.statusCode === 401 || response.statusCode === 403) {
        handleAuthError();
      } else {
        console.error(`Backend status update failed: Status ${response.statusCode}`, response.data);
        const message = response.data?.message || `更新状态失败: 状态 ${response.statusCode}`;
        Taro.showToast({ title: message, icon: 'none' });
      }

    } catch (err) {
      console.error("Network error updating status:", err);
      Taro.showToast({ title: '网络错误', icon: 'none' });
    } finally {
      setIsUpdatingStatus(false);
    }
    return false;
  }, [isUpdatingStatus, handleAuthError, itemId, itemType]);

  const fetchItemDetails = useCallback(async (id, type, token) => {
    console.log(`Workspaceing ${type} details for ID: ${id}`);
    setIsLoading(true);
    setError(null);

    let apiUrl;
    if (type === 'resource') {
      apiUrl = API_BASE_URL + `/api/resource/${id}`;
    } else if (type === 'match') {
      apiUrl = API_BASE_URL + `/api/match/${id}`;
    } else if (type === 'errand') {
      apiUrl = API_BASE_URL + `/api/errand/${id}`;
    } else {
      console.error("Unknown item type in URL:", type);
      setError("Error: Unknown item type.");
      setIsLoading(false);
      return;
    }

    try {
      const response = await Taro.request({
        url: apiUrl,
        method: 'GET',
        header: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.statusCode === 200 && response.data) {
        console.log(`${type} details fetched successfully:`, response.data);
        setItemData(response.data);
      } else if (response.statusCode === 404) {
        setError(`Item not found: ${id}`);
        console.error(`${type} not found:`, response.statusCode, response.data);
      } else if (response.statusCode === 401 || response.statusCode === 403) {
        handleAuthError();
      } else {
        setError(`Failed to fetch ${type} details: Status ${response.statusCode}`);
        console.error(`Failed to fetch ${type} details:`, response.statusCode, response.data);
      }

    } catch (err) {
      console.error(`Network error fetching ${type} details:`, err);
      setError('Network error, could not fetch details.');
    } finally {
      setIsLoading(false);
    }
  }, [handleAuthError]);

  useEffect(() => {
    const router = Taro.getCurrentInstance().router;
    const params = router?.params || {};

    const id = params.id;
    const type = params.type;

    if (!id || !type) {
      console.error("Error: Missing item ID or type in URL parameters.");
      setError("Error loading order details: Missing item ID or type.");
      setIsLoading(false);
      return;
    }

    setItemId(id);
    setItemType(type);

    const userId = Taro.getStorageSync('userId');
    const authToken = Taro.getStorageSync('authToken');
    setCurrentUserId(userId);

    if (!authToken) {
      console.log('No auth token found, cannot fetch data.');
      handleAuthError();
      return;
    }

    fetchItemDetails(id, type, authToken);

  }, [fetchItemDetails, handleAuthError]);


  // MODIFIED: handleCopyRequest to intelligently extract data based on itemType
  const handleCopyRequest = () => {
    if (!itemData) {
      console.warn("No item data to copy.");
      Taro.showToast({ title: '无法复制物品信息', icon: 'none' });
      return;
    }

    console.log("Preparing to copy item data to Request page:", itemData);

    let prefillName = '';
    let prefillDescription = '';
    let prefillType = 'buy'; // Default type for a new request if not derived
    let prefillPrice = '';
    let prefillSpecs = {};

    if (itemData.type === 'resource') {
      prefillName = itemData.name || '';
      prefillDescription = itemData.description || '';
      prefillType = itemData.type || 'buy'; // Use original resource type (e.g., 'buy', 'sell', 'rent', 'service-request')
      prefillPrice = itemData.price !== undefined ? itemData.price.toString() : '';
      prefillSpecs = itemData.specifications || {};
    } else if (itemData.type === 'match') {
      // For a match, copy the details of resource1 as a general request
      if (itemData.resource1) {
        prefillName = itemData.resource1.name || '';
        prefillDescription = itemData.resource1.description || '';
        prefillType = itemData.resource1.type || 'buy';
        prefillPrice = itemData.resource1.price !== undefined ? itemData.resource1.price.toString() : '';
        prefillSpecs = itemData.resource1.specifications || {};
      }
    } else if (itemData.type === 'errand') {
      // For an errand, copy the details of the resource it was for
      if (itemData.resourceRequestId) { // resourceRequestId should be populated resource object
        prefillName = itemData.resourceRequestId.name || '';
        prefillDescription = itemData.resourceRequestId.description || '';
        prefillType = itemData.resourceRequestId.type || 'buy';
        prefillPrice = itemData.resourceRequestId.price !== undefined ? itemData.resourceRequestId.price.toString() : '';
        prefillSpecs = itemData.resourceRequestId.specifications || {};
      }
    }

    const prefillParams = {
      name: prefillName,
      description: prefillDescription,
      type: prefillType,
      price: prefillPrice,
    };

    if (Object.keys(prefillSpecs).length > 0) {
      prefillParams.userSpecs = JSON.stringify(prefillSpecs);
    }

    const queryString = Object.keys(prefillParams)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(prefillParams[key])}`)
      .join('&');

    Taro.navigateTo({
      url: `/pages/request/index?${queryString}`
    });
  };

  const handleDispute = () => {
    // Basic check to ensure navigation and orderData are available
    if (!navigation || !orderData || !orderData._id) {
      console.warn("Navigation object or orderData not available for dispute action.");
      // Optionally show an alert to the user
      // Alert.alert("无法申诉", "订单信息不完整，请稍后再试。");
      return;
    }

    // Collect relevant data from the current order to pass to the feedback page.
    // This helps pre-populate the feedback form for the user.
    const feedbackParams = {
      context: 'order_dispute', // Custom context to indicate this is a dispute
      orderId: orderData._id,
      orderName: orderData.name || `订单 ${orderData._id}`, // Fallback for name
      // You can add more order details here as needed for the feedback form
      // e.g., requesterId: orderData.userId,
      // runnerId: orderData.assignedRunnerId,
      // status: orderData.status,

      // Pre-fill the subject and initial message for the feedback form
      subject: `订单申诉: ${orderData.name || orderData._id}`, // Subject for the feedback
      initialMessage: `我希望针对订单 ${orderData.name || orderData._id} 提出申诉。\n\n请在此详细描述您遇到的问题：` // Initial message body
    };

    // Navigate to the feedback page, passing the data as parameters.
    // Replace 'FeedbackPage' with the actual route name for your feedback screen.
    // If your feedback screen is nested within a navigator (e.g., 'UserStack' -> 'FeedbackScreen'),
    // you might use: navigation.navigate('UserStack', { screen: 'FeedbackScreen', params: feedbackParams });
    navigation.navigate('FeedbackPage', feedbackParams);

    console.log(`Navigating to feedback page for order dispute with ID: ${orderData._id}`);
  };

  const handleEditResource = (resourceId) => {
    if (!resourceId) {
      console.warn("Attempted to edit resource with no ID.");
      Taro.showToast({ title: '无法编辑：缺少ID', icon: 'none' });
      return;
    }
    console.log("Navigating to Request page for editing resource ID:", resourceId);
    Taro.navigateTo({
      url: `/pages/request/index?resourceId=${resourceId}`
    });
  };

  const handleCancelResource = async (resourceId) => {
    if (!resourceId) {
      console.warn("Attempted to cancel resource with no ID.");
      Taro.showToast({ title: '无法取消：缺少ID', icon: 'none' });
      return;
    }

    const confirm = await Taro.showModal({
      title: '确认取消',
      content: '确定要取消此请求吗？',
      confirmText: '确定',
      cancelText: '返回',
    });

    if (confirm.confirm) {
      console.log("User confirmed cancellation for resource ID:", resourceId);
      await callUpdateStatusApi(API_BASE_URL + `/api/resource/${resourceId}`, { status: 'canceled' }, 'PUT');
    } else {
      console.log("User cancelled cancellation.");
    }
  };

  const handleAcceptAndNavigate = async (matchId) => {
    console.log("Attempting to accept match ID:", matchId);
    const success = await callUpdateStatusApi(API_BASE_URL + `/api/match/${matchId}/accept`, {}, 'POST');
    if (success) {
      navigateToConfirmation('match');
    }
  };

  const handleDeclineMatch = async (matchId) => {
    if (!matchId) {
      Taro.showToast({ title: '无法拒绝：缺少ID', icon: 'none' });
      return;
    }
    const confirmDecline = await Taro.showModal({
      title: '确认拒绝',
      content: '确定要拒绝此匹配吗？',
      confirmText: '确定',
      cancelText: '取消',
    });

    if (confirmDecline.confirm) {
      await callUpdateStatusApi(API_BASE_URL + `/api/match/${matchId}/decline`, { status: 'declined' }, 'POST');
    }
  };

  const navigateToConfirmation = (targetType) => {
    const orderId = itemData._id;
    const typeToPass = targetType || itemType;

    if (orderId && typeToPass) {
      console.log(`Navigating to confirmation page with ID: ${orderId} and type: ${typeToPass}`);
      Taro.navigateTo({
        url: `/pages/orderConfirmation/index?orderId=${orderId}&type=${typeToPass}`
      });
    } else {
      console.warn("Attempted to navigate to confirmation with missing ID or type.");
      Taro.showToast({ title: '无法确认此物品', icon: 'none' });
    }
  };

  const handlePickupErrand = async (errandId) => {
    if (!errandId) {
      Taro.showToast({ title: '无法标记取货：缺少ID', icon: 'none' });
      return;
    }
    await callUpdateStatusApi(API_BASE_URL + `/api/errand/${errandId}/pickup`, { status: 'picked_up' }, 'PUT');
  };

  const handleDropoffErrand = async (errandId) => {
    if (!errandId) {
      Taro.showToast({ title: '无法标记送达：缺少ID', icon: 'none' });
      return;
    }
    await callUpdateStatusApi(API_BASE_URL + `/api/errand/${errandId}/dropoff`, { status: 'dropped_off' }, 'PUT');
  };

  const handleCompleteErrand = async (errandId) => {
    if (!errandId) {
      Taro.showToast({ title: '无法完成订单：缺少ID', icon: 'none' });
      return;
    }
    await callUpdateStatusApi(API_BASE_URL + `/api/errand/${errandId}/complete`, { status: 'completed' }, 'PUT');
  };

  if (isLoading) {
    return <View className="loading-container"><Text>加载详情...</Text></View>;
  }
  if (error) {
    return <View className="error-container"><Text>加载详情出错: {error}</Text></View>;
  }
  if (!itemData) {
    return <View className="no-data-container"><Text>暂无物品数据。</Text></View>;
  }

  const handleCompleteMatch = useCallback(async () => {
    if (!itemData || !itemId) {
      Taro.showToast({ title: '匹配信息缺失', icon: 'none' });
      return;
    }

    setIsConfirmingMatch(true); // Set loading state for the button
    Taro.showLoading({ title: '确认中...' }); // Show global loading indicator

    const authToken = Taro.getStorageSync('authToken');

    try {
      const response = await Taro.request({
        url: API_BASE_URL + `/api/match/${itemId}/complete`, // Your backend API endpoint
        method: 'PUT', // Or POST, depending on your API design
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        // body: JSON.stringify({ /* You might send additional data here if needed by API */ })
      });

      if (response.statusCode === 200) {
        Taro.showToast({ title: '确认收货成功！', icon: 'success' });
        fetchItemDetails(); // Refresh item details to update status
      } else {
        Taro.showToast({ title: response.data.message || '确认收货失败。', icon: 'none' });
      }
    } catch (error) {
      console.error('Error completing match:', error);
      Taro.showToast({ title: '网络错误，确认失败。', icon: 'none' });
    } finally {
      setIsConfirmingMatch(false); // Reset loading state for the button
      Taro.hideLoading(); // Hide global loading indicator
    }
  }, [itemData, itemId, fetchItemDetails]); // Dependencies for useCallback

  console.log("--- Order Detail Debug ---");
  console.log("itemData:", itemData);
  console.log("currentUserId:", currentUserId);
  console.log("itemType (from URL):", itemType);

  const isOwnerOfResource = itemData.type === 'resource' && itemData.owner?._id?.toString() === currentUserId;
  const isRequesterOfMatch = itemData.type === 'match' && itemData.requester?._id?.toString() === currentUserId;
  const isOwnerOfMatch = itemData.type === 'match' && itemData.owner?._id?.toString() === currentUserId;
  const isErrandRunner = itemData.type === 'errand' && itemData.errandRunner?._id?.toString() === currentUserId;
  const isErrandRequester = itemData.type === 'errand' && itemData.requester?._id?.toString() === currentUserId;
  const isServiceRequest = itemType === 'resource' && itemData.requestType === 'service-request';
  const showConfirmReceiptButton =
    itemType === 'match' && // It must be a match type item
    isRequesterOfMatch && // The current user must be the requester of this match
    itemData.status !== 'completed' && // The match status should not already be 'completed'
    itemData.status !== 'cancelled' && // The match status should not be 'cancelled'
    itemData.serviceRequest && // Ensure serviceRequest exists
    itemData.serviceRequest.assignedErrandID && // Ensure an assigned errand exists for the service request
    itemData.serviceRequest.assignedErrandID.status === 'completed'; // The assigned errand's status must be 'completed'

  console.log("isOwnerOfResource (for service-request):", isOwnerOfResource);
  console.log("isRequesterOfMatch:", isRequesterOfMatch);
  console.log("isOwnerOfMatch:", isOwnerOfMatch);
  console.log("isErrandRunner:", isErrandRunner);
  console.log("isErrandRequester:", isErrandRequester);
  console.log("isServiceRequest:", isServiceRequest);
  console.log("itemData.status:", itemData.status);
  console.log("--------------------------");

  return (
    <View className="order-detail-page">
      <ScrollView className="content-container" scrollY>

        <Text className="page-title">
          {itemType === 'resource' ? (isServiceRequest ? '服务请求详情' : '资源详情') :
            itemType === 'match' ? '匹配详情' :
              itemType === 'errand' ? '跑腿详情' :
                '物品详情'}
        </Text>

        <View className="section common-details">
          <Text className="section-title">基本信息</Text>
          {itemData.name && <Text className="detail-item">名称: {itemData.name}</Text>}
          {itemData.description && <Text className="detail-item">描述: {itemData.description}</Text>}
          {itemData.type && <Text className="detail-item">类型: {itemData.type === 'resource' ? (isServiceRequest ? '服务请求' : '资源') : itemData.type === 'match' ? '匹配' : itemData.type === 'errand' ? '跑腿' : itemData.type}</Text>}

          {displayItemMedia(itemData, "item-media-detail")}

          {itemData.specifications && Object.keys(itemData.specifications).length > 0 && (
            <View className="specs-list">
              <Text className="specs-title">规格:</Text>
              {Object.entries(itemData.specifications).map(([key, value]) => (
                typeof value === 'object' && value !== null && value.district && value.building ? (
                  <Text key={key} className="detail-item">{key}: {value.addressLine1 || value.district} {value.building}</Text>
                ) : (
                  <Text key={key} className="detail-item">{key}: {JSON.stringify(value)}</Text>
                )
              ))}
            </View>
          )}
        </View>

        {itemType === 'resource' && (
          <View className="section resource-details-section">
            <Text className="section-title">{isServiceRequest ? '服务请求特定信息' : '资源特定信息'}</Text>
            {itemData.price !== undefined && <Text className="detail-item">价格: ¥{itemData.price.toFixed(2)}</Text>}
            {itemData.owner && <Text className="detail-item">发布者: {itemData.owner.username || itemData.owner.name || '未知'}</Text>}
            {itemData.status && <Text className="detail-item">状态: {itemData.status}</Text>}
          </View>
        )}

        {itemType === 'match' && (
          <View className="section match-details-section">
            <Text className="section-title">匹配特定信息</Text>
            {itemData.resource1 && itemData.resource2 && (
              <View className="detail-group">
                <Text className="detail-item-heading">匹配资源:</Text>
                <Text className="detail-item">- 资源1: {itemData.resource1.name} (来自 {itemData.owner?.username || '未知'})</Text>
                <Text className="detail-item">- 资源2: {itemData.resource2.name} (来自 {itemData.requester?.username || '未知'})</Text>
              </View>
            )}
            {itemData.agreedPrice !== undefined && (
              <Text className="detail-item">协商价格: ¥{itemData.agreedPrice.toFixed(2)}</Text>
            )}
            {itemData.finalAmount !== undefined && (
              <Text className="detail-item">最终金额: ¥{itemData.finalAmount.toFixed(2)}</Text>
            )}
            {itemData.pickupLocation && itemData.dropoffLocation && (
              <View className="detail-group">
                <Text className="detail-item-heading">交换地点:</Text>
                <Text className="detail-item">- 取货点: {itemData.pickupLocation.addressLine1 || itemData.pickupLocation.district || '未知'}</Text>
                <Text className="detail-item">- 送货点: {itemData.dropoffLocation.addressLine1 || itemData.dropoffLocation.district || '未知'}</Text>
              </View>
            )}
            {itemData.status && <Text className="detail-item">状态: {itemData.status}</Text>}
          </View>
        )}

        {itemType === 'errand' && (
          <View className="section errand-details-section">
            <Text className="section-title">跑腿服务信息</Text>
            {itemData.resourceRequestId?.name && (
              <Text className="detail-item">代购物品: {itemData.resourceRequestId.name}</Text>
            )}
            {itemData.deliveryFee !== undefined && (
              <Text className="detail-item">跑腿费: ¥{itemData.deliveryFee.toFixed(2)}</Text>
            )}
            {itemData.pickupLocation && (
              <Text className="detail-item">取货点: {itemData.pickupLocation.addressLine1 || itemData.pickupLocation.district || '未知'}</Text>
            )}
            {itemData.dropoffLocation && (
              <Text className="detail-item">送货点: {itemData.dropoffLocation.addressLine1 || itemData.dropoffLocation.district || '未知'}</Text>
            )}
            {itemData.expectedTimeframeString && (
              <Text className="detail-item">预计完成时间: {itemData.expectedTimeframeString}</Text>
            )}
            {itemData.isDeliveryToDoor && (
              <Text className="detail-item">送货上门: 是 {itemData.doorDeliveryUnits ? `(${itemData.doorDeliveryUnits} 层)` : ''}</Text>
            )}
            {itemData.requester && (
              <Text className="detail-item">请求者: {itemData.requester.username || itemData.requester.name || '未知'}</Text>
            )}
            {itemData.errandRunner ? (
              <View className="detail-group">
                <Text className="detail-item-heading">跑腿服务人员:</Text>
                <Text className="detail-item">姓名: {itemData.errandRunner.username || itemData.errandRunner.name || '未知'}</Text>
              </View>
            ) : (
              <Text className="detail-item">跑腿服务人员: 尚未分配</Text>
            )}
            {itemData.status && <Text className="detail-item">状态: {itemData.status}</Text>}
          </View>
        )}

        <View className="section common-actions">
          <Text className="section-title">操作</Text>

          {/* Consolidated Copy Request button - available for all order types */}
          <Button className="action-button copy-button" onClick={handleCopyRequest} disabled={isUpdatingStatus}>
            复制请求
          </Button>

          {/* NEW: Dispute button */}
          {/* Ensure `isUpdatingStatus` also disables this button during updates if desired */}
          <Button className="action-button dispute-button" onClick={handleDispute} disabled={isUpdatingStatus}>
            订单申诉
          </Button>
        </View>
        <View className="section specific-actions">
          {/* Buttons for Resource (including Service Requests) */}
          {itemType === 'resource' && isOwnerOfResource && (
            <>
              {(itemData.status === 'submitted' || itemData.status === 'matching') && (
                <>
                  <Button className="action-button edit-button" onClick={handleEditResource.bind(null, itemData._id)} disabled={isUpdatingStatus}>编辑</Button>
                  <Button className="action-button cancel-button" onClick={handleCancelResource.bind(null, itemData._id)} disabled={isUpdatingStatus}>取消</Button>
                </>
              )}
              {isServiceRequest && itemData.status === 'submitted' && (
                <Button className="action-button pay-button" onClick={() => navigateToConfirmation('resource')} disabled={isUpdatingStatus}>去支付</Button>
              )}

              {itemData.status === "canceled" && <Text className="static-status-text status-canceled">已取消</Text>}
              {itemData.status === "completed" && <Text className="static-status-text status-completed">已完成</Text>}
              {isServiceRequest && itemData.status === "pending" && <Text className="static-status-text status-pending">待支付</Text>}
              {isServiceRequest && itemData.status === "paid" && <Text className="static-status-text status-paid">已支付 (待处理)</Text>}
            </>
          )}

          {/* Buttons/Status for Match */}
          {itemType === 'match' && (
            <>
              {itemData.status === 'pending' && (isRequesterOfMatch || isOwnerOfMatch) && (
                <>
                  <Button className="action-button accept-button" onClick={handleAcceptAndNavigate.bind(null, itemData._id)} disabled={isUpdatingStatus}>接受</Button>
                  <Button className="action-button decline-button" onClick={handleDeclineMatch.bind(null, itemData._id)} disabled={isUpdatingStatus}>拒绝</Button>
                </>
              )}
              {itemData.status === 'accepted' && isRequesterOfMatch && (
                <Button className="action-button pay-button" onClick={() => navigateToConfirmation('match')} disabled={isUpdatingStatus}>去支付</Button>
              )}
              {itemData.status === 'paid' && isRequesterOfMatch && (
                <Button className="action-button prompt-errand-button" onClick={() => navigateToConfirmation('match')} disabled={isUpdatingStatus}>发布跑腿请求</Button>
              )}

              {itemData.status === 'completed' && <Text className="static-status-text status-completed">已完成</Text>}
              {itemData.status === 'canceled' && <Text className="static-status-text status-canceled">已取消</Text>}
              {itemData.status === 'declined' && <Text className="static-status-text status-declined">已拒绝</Text>}
              {itemData.status === 'paid' && !isRequesterOfMatch && <Text className="static-status-text">已支付</Text>}
              {itemData.status === 'erranding' && <Text className="static-status-text">服务中</Text>}
              {itemData.status === 'accepted' && !isRequesterOfMatch && <Text className="static-status-text">已接受</Text>}
            </>
          )}
          {showConfirmReceiptButton && (
            <Button
              className="action-button primary confirm-receipt-button" // Add a custom class for styling if needed
              onClick={handleCompleteMatch}
              disabled={isConfirmingMatch || isUpdatingStatus} // Disable during own update or other updates
            >
              {isConfirmingMatch ? '确认中...' : '确认收货'}
            </Button>
          )}

          {/* Buttons/Status for Errand */}
          {itemType === 'errand' && (
            <>
              {isErrandRunner && itemData.status === 'assigned' && (
                <Button className="action-button primary" onClick={handlePickupErrand.bind(null, itemData._id)} disabled={isUpdatingStatus}>
                  标记为已取货 (上传照片)
                </Button>
              )}
              {isErrandRunner && itemData.status === 'picked_up' && (
                <Button className="action-button primary" onClick={handleDropoffErrand.bind(null, itemData._id)} disabled={isUpdatingStatus}>
                  标记为已送达 (上传照片)
                </Button>
              )}
              {isErrandRunner && itemData.status === 'dropped_off' && (
                <Button className="action-button primary" onClick={handleCompleteErrand.bind(null, itemData._id)} disabled={isUpdatingStatus}>
                  完成订单
                </Button>
              )}

              {(itemData.status === 'pending' || itemData.status === 'assigned' ||
                itemData.status === 'picked_up' || itemData.status === 'dropped_off' ||
                itemData.status === 'completed' || itemData.status === 'cancelled' || itemData.status === 'expired') && (
                  <>
                    {itemData.status === 'pending' && <Text className="static-status-text">待处理</Text>}
                    {itemData.status === 'assigned' && !isErrandRunner && <Text className="static-status-text">已分配服务人员</Text>}
                    {itemData.status === 'picked_up' && !isErrandRunner && <Text className="static-status-text">已取货</Text>}
                    {itemData.status === 'dropped_off' && !isErrandRunner && <Text className="static-status-text">已送达</Text>}
                    {itemData.status === 'completed' && <Text className="static-status-text status-completed">已完成</Text>}
                    {itemData.status === 'cancelled' && <Text className="static-status-text status-canceled">已取消</Text>}
                    {itemData.status === 'expired' && <Text className="static-status-text status-declined">已过期</Text>}
                  </>
                )}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: "详情",
});
