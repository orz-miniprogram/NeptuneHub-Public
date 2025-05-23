// frontend/src/components/OrderComponent/index.jsx

import React, { useState, useEffect } from 'react';
import { View, Text, Button, Image } from "@tarojs/components";
import Taro from "@tarojs/taro";
import "./OrderComponent.scss";

// Props:
// order: The full order object (resource, match, or errand)
// onAccept: Handler for 'Accept' match button (navigates to confirmation)
// onClick: Handler for clicking the entire order component (navigates to details)
// handleCancelResource: Handler for canceling a resource (passed from parent)
// handleDeclineMatch: Handler for declining a match (passed from parent)
// handleEditRequest: Handler for editing a resource (passed from parent)
// handlePickupErrand: Handler for marking an errand as picked up (passed from parent)
// handleDropoffErrand: Handler for marking an errand as dropped off (passed from parent)
// handleCompleteErrand: Handler for completing an errand (passed from parent)
// currentUserId: The ID of the currently logged-in user (passed from parent)
// isUpdatingStatus: Boolean to disable action buttons during API calls (passed from parent)

export default function OrderComponent({
  order,
  onAccept,
  onClick,
  handleCancelResource,
  handleDeclineMatch,
  handleEditRequest,
  handlePickupErrand,
  handleDropoffErrand,
  handleCompleteErrand,
  handleCompleteMatch,
  currentUserId,       // Received as prop now
  isUpdatingStatus     // Received as prop now
}) {

  const { _id, status, type } = order; // Destructure commonly used fields

  const [relevantPayment, setRelevantPayment] = useState(null);
  const [primaryMediaUrl, setPrimaryMediaUrl] = useState(null);
  const [relevantTitle, setRelevantTitle] = useState(null);
  const [loading, setLoading] = useState(true); // Loading for initial resource data

  // Removed internal currentUserId and isUpdatingStatus state, as they are now props

  useEffect(() => {
    // currentUserId is now passed as a prop, no need to fetch from Storage here
    // const storedUserId = Taro.getStorageSync('userId');
    // setCurrentUserId(storedUserId); // This line is removed

    const loadOrderDisplayData = async () => {
      setLoading(true);
      let title = '';
      let mediaUrl = '';
      let payment = null;

      switch (type) {
        case "match":
          if (order.requester?._id?.toString() === currentUserId && order.resource1) {
            title = order.resource1.name || '';
            mediaUrl = order.resource1?.media?.[0];
            payment = order.resource1Payment;
          } else if (order.owner?._id?.toString() === currentUserId && order.resource2) {
            title = order.resource2.name || '';
            mediaUrl = order.resource2?.media?.[0];
            payment = order.resource2Receipt;
          }
          break;
        case "resource":
          title = order.name || '';
          mediaUrl = order.media?.[0];
          payment = order.price;
          break;
        case "errand":
          title = order.resourceRequestId?.name || 'Errand Service'; // Assuming resourceRequestId is populated
          mediaUrl = order.resourceRequestId?.media?.[0]; // Assuming resourceRequestId has media
          payment = order.deliveryFee;
          break;
        default:
          title = 'Unknown Order Type';
          mediaUrl = '';
          payment = null;
      }

      // Construct full media URL
      const fullMediaUrl = mediaUrl ?
        (mediaUrl.startsWith('http') ? mediaUrl : API_BASE_URL + '/media/' + mediaUrl) :
        'placeholder.jpg';

      setRelevantTitle(title);
      setPrimaryMediaUrl(fullMediaUrl);
      setRelevantPayment(payment);
      setLoading(false);
    };

    loadOrderDisplayData();
    // Dependencies for this useEffect: order, type, currentUserId (prop)
  }, [order, type, currentUserId]);

  // --- Action Handlers for Status Updates (These are now passed as props) ---
  // The internal callUpdateStatusApi and related handlers are removed from here
  // because the parent (Orders.jsx) is responsible for making the API calls and re-fetching data.

  // We keep a wrapper around the passed props to stop event propagation
  const handleStopPropagationAndCall = (handler, ...args) => (e) => {
    e.stopPropagation();
    if (handler) { // Ensure handler is not undefined
      handler(...args);
    } else {
      console.warn(`Handler is not defined for this action.`);
    }
  };

  const showConfirmReceiptButton =
    type === 'match' && // Use the 'type' prop
    order.requester?._id?.toString() === currentUserId && // Check if the current user is the requester
    status !== 'completed' && // Use the 'status' prop
    status !== 'cancelled' && // Use the 'status' prop
    order.serviceRequest &&
    order.serviceRequest.assignedErrandID &&
    order.serviceRequest.assignedErrandID.status === 'completed';

  if (loading) {
    return <View className="order-component-loading">Loading order details...</View>;
  }


  return (
    <View className="order-component" onClick={onClick ? () => onClick(_id, type) : undefined}>
      <View className="order-content-sections">
        {/* --- Top Header Row: Title/Payment on Left, Status --- */}
        <View className="order-header-row">
          {/* Left Side: Title and Payment */}
          <View className="order-info-left">
            <Text className="order-title">{relevantTitle}</Text>
            {relevantPayment !== null && relevantPayment !== undefined && <Text className="order-payment">支付: ¥{relevantPayment.toFixed(2)}</Text>}
          </View>

          {/* Right Side: Status and Media Grouped */}
          <View className="order-info-right">
            {/* Status Text (placed on the right side) */}
            <Text className="order-status">状态: {status}</Text>
          </View>
        </View>

        {/* --- Errand Specific Details (New Section) --- */}
        {type === 'errand' && (
          <View className="errand-details-section">
            {order.pickupLocation && (
              <Text className="detail-text">取货点: {order.pickupLocation.addressLine1 || order.pickupLocation.district || '未知'}</Text>
            )}
            {order.dropoffLocation && (
              <Text className="detail-text">送货点: {order.dropoffLocation.addressLine1 || order.dropoffLocation.district || '未知'}</Text>
            )}
            {order.expectedTimeframeString && (
              <Text className="detail-text">预计时间: {order.expectedTimeframeString}</Text>
            )}
            {order.isDeliveryToDoor && (
              <Text className="detail-text">送货上门: {order.doorDeliveryUnits ? `${order.doorDeliveryUnits} 层` : '是'}</Text>
            )}
          </View>
        )}

        {/* --- Action Buttons Section (remains at the bottom) --- */}
        {order.type && status && currentUserId && ( // Ensure item data is loaded before checking
          <View className="order-actions">
            {/* Resource Actions */}
            {type === 'resource' && status === 'matching' && order.userId?._id?.toString() === currentUserId && (
              <>
                <Button className="action-button" onClick={handleStopPropagationAndCall(handleEditRequest, order._id)} disabled={isUpdatingStatus}>编辑</Button>
                <Button className="action-button" onClick={handleStopPropagationAndCall(handleCancelResource, order._id)} disabled={isUpdatingStatus}>取消</Button>
              </>
            )}
            {type === "resource" && status === "canceled" && (
              <Text className="static-status-text">已取消</Text>
            )}

            {/* Match Actions */}
            {type === 'match' && (
              <>
                {status === 'pending' && (order.owner?._id?.toString() === currentUserId || order.requester?._id?.toString() === currentUserId) && (
                  <>
                    <Button className="action-button" onClick={handleStopPropagationAndCall(onAccept, _id)} disabled={isUpdatingStatus || !onAccept}>接受</Button>
                    <Button className="action-button" onClick={handleStopPropagationAndCall(handleDeclineMatch, _id)} disabled={isUpdatingStatus}>拒绝</Button>
                  </>
                )}
                {/* Static texts for Match statuses */}
                {(status === 'accepted' || status === 'paid' || status === 'erranding' || status === 'completed' || status === 'canceled' || status === 'declined') && (
                  (status === 'completed' && <Text className="static-status-text">已完成</Text>) ||
                  (status === 'canceled' && <Text className="static-status-text">已取消</Text>) ||
                  (status === 'declined' && <Text className="static-status-text">已拒绝</Text>) ||
                  (status === 'paid' && <Text className="static-status-text">已支付</Text>) ||
                  (status === 'erranding' && <Text className="static-status-text">服务中</Text>) ||
                  (status === 'accepted' && <Text className="static-status-text">已接受</Text>)
                )}
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
            {/* Errand Actions (New Section) */}
            {type === 'errand' && order.errandRunner?._id?.toString() === currentUserId && (
              <>
                {status === 'assigned' && (
                  <Button
                    className="action-button primary"
                    onClick={handleStopPropagationAndCall(handlePickupErrand, _id)}
                    disabled={isUpdatingStatus}
                  >
                    标记为已取货 (上传照片)
                  </Button>
                )}

                {status === 'picked_up' && (
                  <Button
                    className="action-button primary"
                    onClick={handleStopPropagationAndCall(handleDropoffErrand, _id)}
                    disabled={isUpdatingStatus}
                  >
                    标记为已送达 (上传照片)
                  </Button>
                )}

                {status === 'dropped_off' && (
                  <Button
                    className="action-button primary"
                    onClick={handleStopPropagationAndCall(handleCompleteErrand, _id)}
                    disabled={isUpdatingStatus}
                  >
                    完成订单
                  </Button>
                )}
              </>
            )}

            {/* Static Status Text for Errands (for both requester and runner) */}
            {type === 'errand' && (
              (status === 'pending' && <Text className="static-status-text">待处理</Text>) ||
              (status === 'assigned' && order.errandRunner?._id?.toString() !== currentUserId && <Text className="static-status-text">已分配服务人员</Text>) || // For requester
              (status === 'picked_up' && order.errandRunner?._id?.toString() !== currentUserId && <Text className="static-status-text">已取货</Text>) || // For requester
              (status === 'dropped_off' && order.errandRunner?._id?.toString() !== currentUserId && <Text className="static-status-text">已送达</Text>) || // For requester
              (status === 'completed' && <Text className="static-status-text">已完成</Text>) ||
              (status === 'cancelled' && <Text className="static-status-text">已取消</Text>) ||
              (status === 'expired' && <Text className="static-status-text">已过期</Text>)
            )}
          </View>
        )}
      </View>
      {/* Media Thumbnail (placed next to status on the right side) */}
      <View className="media-square-container">
        {primaryMediaUrl && primaryMediaUrl !== 'placeholder.jpg' ? (
          <Image src={primaryMediaUrl} className="order-media" mode="aspectFill" />
        ) : (
          <Image src="placeholder.jpg" className="order-media" mode="aspectFill" />
        )}
      </View>
    </View>
  );
}
