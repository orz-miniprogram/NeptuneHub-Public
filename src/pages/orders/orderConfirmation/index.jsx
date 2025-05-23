import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Button, ScrollView, Input, Picker, Checkbox } from '@tarojs/components';
import Taro from '@tarojs/taro';

import './index.scss'; // Optional: for styling

const DOOR_DELIVERY_FEE = 5.00; // RM5 for door delivery (for non-errand orders that opt in)

const DELIVERY_TIME_SLOTS = [
  { label: '上午 (9:00 AM - 12:00 PM)', value: '0900-1200' },
  { label: '下午 (1:00 PM - 5:00 PM)', value: '1300-1700' },
  { label: '晚上 (6:00 PM - 9:00 PM)', value: '1800-2100' },
];

export default function OrderConfirmationPage() {
  const [orderId, setOrderId] = useState(null);
  const [order, setOrder] = useState(null);
  const [isLoadingOrder, setIsLoadingOrder] = useState(true);
  const [error, setError] = useState(null);

  const [couponCode, setCouponCode] = useState('');
  const [selectedCoupon, setSelectedCoupon] = useState(null);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [couponError, setCouponError] = useState(null);

  const [paymentMethods, setPaymentMethods] = useState([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
  const [isLoadingPaymentMethods, setIsLoadingPaymentMethods] = useState(true);

  const [isInitiatingPayment, setIsInitiatingPayment] = useState(false);

  // --- States for Door Delivery (applicable for non-errand orders that select it HERE) ---
  const [isDoorDeliverySelected, setIsDoorDeliverySelected] = useState(false);
  const [userAddresses, setUserAddresses] = useState([]); // To store the current user's saved addresses
  const [selectedDeliveryAddressId, setSelectedDeliveryAddressId] = useState(null); // _id of the chosen address
  const [selectedDeliveryTime, setSelectedDeliveryTime] = useState(null); // Chosen time slot string (from DELIVERY_TIME_SLOTS)
  const [isLoadingUserAddresses, setIsLoadingUserAddresses] = useState(true);

  // --- State to determine if the order is an errand (service-request) ---
  const [isOrderTypeServiceRequest, setIsOrderTypeServiceRequest] = useState(false);

  // --- States for Errand-specific Delivery Times (fetched from resource specifications) ---
  const [errandTimeMode, setErrandTimeMode] = useState(null); // 'off', 'starting', 'arrival'
  const [errandStartingTime, setErrandStartingTime] = useState(null); // HH:MM for starting or off
  const [errandArrivalTime, setErrandArrivalTime] = useState(null);   // HH:MM for arrival

  // --- NEW State: To identify if this is a 'match' order requiring service request setup ---
  const [isMatchRequiringSRSetup, setIsMatchRequiringSRSetup] = useState(false);


  // Helper function to handle authentication errors and redirect
  const handleAuthError = useCallback(() => {
    console.warn('Authentication failed, redirecting to login...');
    Taro.removeStorageSync('authToken');
    Taro.removeStorageSync('userId');
    Taro.redirectTo({ url: '/pages/user/login/index' });
  }, []);

  // --- Effect to fetch Order ID from params and load data ---
  useEffect(() => {
    const router = Taro.getCurrentInstance().router;
    const id = router?.params?.orderId;

    if (!id) {
      setError('Order ID is missing.');
      setIsLoadingOrder(false);
      console.error('Order ID not found in navigation parameters.');
      Taro.showToast({ title: '订单未找到', icon: 'none' }); // Translate: Order not found
      return;
    }

    setOrderId(id);

    const fetchData = async (id) => {
      setIsLoadingOrder(true);
      setIsLoadingPaymentMethods(true);
      setIsLoadingUserAddresses(true);
      setError(null);

      const authToken = Taro.getStorageSync('authToken');
      if (!authToken) {
        console.log('No auth token found, redirecting to login from Order Confirmation.');
        Taro.showToast({ title: '请登录以查看订单', icon: 'none' }); // Translate: Please login to view order
        setTimeout(() => { handleAuthError(); }, 1500);
        return;
      }

      try {
        // --- Fetch Order Details ---
        const orderResponse = await Taro.request({
          url: API_BASE_URL + `/api/orders/${id}`,
          method: 'GET',
          header: { 'Authorization': `Bearer ${authToken}` },
        });

        if (orderResponse.statusCode === 200 && orderResponse.data) {
          const fetchedOrder = orderResponse.data;
          setOrder(fetchedOrder);
          console.log('Fetched order details:', fetchedOrder);

          const isCurrentOrderServiceRequest = fetchedOrder.resource?.type === 'service-request';
          setIsOrderTypeServiceRequest(isCurrentOrderServiceRequest);

          // --- NEW: Check if this is a 'match' order that requires SR setup ---
          // This relies on a new property from your backend, e.g., `requiresServiceRequestTimeInput`
          // that backend sets if a match needs to define service request time/address.
          const shouldRequireSRSetup = fetchedOrder.resource?.type === 'match' && fetchedOrder.requiresServiceRequestTimeInput === true;
          setIsMatchRequiringSRSetup(shouldRequireSRSetup);

          // Initialize states for errand-specific delivery times (for display only)
          if (isCurrentOrderServiceRequest && fetchedOrder.resource?.specifications) {
            setErrandTimeMode(fetchedOrder.resource.specifications.time_mode || null);
            setErrandStartingTime(fetchedOrder.resource.specifications.starting_time || null);
            setErrandArrivalTime(fetchedOrder.resource.specifications.arrival_time || null);
          } else {
            // Reset errand-specific states if not a service request type
            setErrandTimeMode(null);
            setErrandStartingTime(null);
            setErrandArrivalTime(null);
          }

          // Initialize coupon state if an coupon is already applied
          if (fetchedOrder.appliedCoupon) {
            setSelectedCoupon(fetchedOrder.appliedCoupon);
          }

          // For non-errand orders OR match orders requiring SR setup, initialize door delivery states
          if (!isCurrentOrderServiceRequest || shouldRequireSRSetup) {
            // Default to true for new SR setup from match, or check existing for standard match
            // Assuming `WorkspaceedOrder.deliveryInfo` would contain existing door delivery selection for regular matches
            const existingDoorDelivery = fetchedOrder.deliveryInfo?.isDoorDelivery || false;
            setIsDoorDeliverySelected(existingDoorDelivery || shouldRequireSRSetup); // If SRSetup, default to true

            if (existingDoorDelivery) {
              setSelectedDeliveryAddressId(fetchedOrder.deliveryInfo.deliveryAddressId);
              setSelectedDeliveryTime(fetchedOrder.deliveryInfo.deliveryTime);
            } else if (shouldRequireSRSetup) {
              // For a new SR setup, set default address and time slot
              // Address will be set by `setSelectedDeliveryAddressId(addresses[0]._id)` below
              setSelectedDeliveryTime(DELIVERY_TIME_SLOTS[0]?.value || null);
            }
          } else {
            // If it's an existing service request, these states are irrelevant for input
            setIsDoorDeliverySelected(false);
            setSelectedDeliveryAddressId(null);
            setSelectedDeliveryTime(null);
          }


        } else if (orderResponse.statusCode === 401 || orderResponse.statusCode === 403) {
          handleAuthError();
          return;
        } else {
          console.error(`Failed to fetch order: Status ${orderResponse.statusCode}`, orderResponse.data);
          setError('加载订单详情失败.'); // Translate: Failed to load order details
          Taro.showToast({ title: '加载订单失败', icon: 'none' });
          setIsLoadingOrder(false);
          return;
        }

        // --- Fetch User Profile (for addresses) ---
        const userProfileResponse = await Taro.request({
          url: API_BASE_URL + `/api/auth/profile`, // Endpoint to get current user's profile
          method: 'GET',
          header: { 'Authorization': `Bearer ${authToken}` },
        });

        if (userProfileResponse.statusCode === 200 && userProfileResponse.data && userProfileResponse.data.user) {
          const addresses = userProfileResponse.data.user.addresses || [];
          setUserAddresses(addresses);
          if (addresses.length > 0) {
            // Set first address as default if available for optional door delivery or new SR setup
            if (!selectedDeliveryAddressId) { // Only set if not already set from order data
              setSelectedDeliveryAddressId(addresses[0]._id);
            }
          }
          console.log('Fetched user addresses:', addresses);
        } else if (userProfileResponse.statusCode === 401 || userProfileResponse.statusCode === 403) {
          handleAuthError();
          return;
        } else {
          console.error(`Failed to fetch user profile: Status ${userProfileResponse.statusCode}`, userProfileResponse.data);
          setError('加载用户地址失败.'); // Translate: Failed to load user addresses
          Taro.showToast({ title: '加载用户地址失败', icon: 'none' });
        }


        // --- Fetch Payment Methods ---
        const paymentMethodsResponse = await Taro.request({
          url: API_BASE_URL + `/api/payment/methods`,
          method: 'GET',
          header: { 'Authorization': `Bearer ${authToken}` },
        });

        if (paymentMethodsResponse.statusCode === 200 && Array.isArray(paymentMethodsResponse.data.methods)) {
          setPaymentMethods(paymentMethodsResponse.data.methods);
          if (paymentMethodsResponse.data.methods.length > 0) {
            setSelectedPaymentMethod(paymentMethodsResponse.data.methods[0].value);
          }
          console.log('Fetched payment methods:', paymentMethodsResponse.data.methods);
        } else {
          console.error(`Failed to fetch payment methods: Status ${paymentMethodsResponse.statusCode}`, paymentMethodsResponse.data);
          setError('加载支付方式失败.'); // Translate: Failed to load payment methods
          Taro.showToast({ title: '加载支付方式失败', icon: 'none' });
        }

      } catch (err) {
        console.error('Network error fetching data:', err);
        setError('网络错误，无法加载页面数据.'); // Translate: Network error loading page data
        Taro.showToast({ title: '网络错误', icon: 'none' });
      } finally {
        setIsLoadingOrder(false);
        setIsLoadingPaymentMethods(false);
        setIsLoadingUserAddresses(false);
      }
    };

    if (id) {
      fetchData(id);
    }

  }, [handleAuthError]);


  // --- Function to handle applying a coupon ---
  const handleApplyCoupon = async () => {
    if (!couponCode.trim() || isApplyingCoupon || !order) {
      return;
    }

    setIsApplyingCoupon(true);
    setCouponError(null);

    const authToken = Taro.getStorageSync('authToken');
    if (!authToken) {
      console.log('No auth token found, preventing coupon application.');
      setCouponError('您必须登录才能使用优惠券.'); // Translate: You must be logged in to apply coupons
      Taro.showToast({ title: '请登录', icon: 'none' });
      setIsApplyingCoupon(false);
      return;
    }

    try {
      const response = await Taro.request({
        url: API_BASE_URL + `/api/match/${orderId}/coupon`, // This endpoint might need to be generalized for all order types
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          couponCode: couponCode.trim(),
        },
      });

      if (response.statusCode === 200 && response.data && response.data.order) {
        setOrder(response.data.order);
        setSelectedCoupon(response.data.order.appliedCoupon || null);
        setCouponCode('');
        Taro.showToast({ title: '优惠券已应用！', icon: 'success' }); // Translate: Coupon applied!
        console.log('Coupon applied successfully. Updated order:', response.data.order);

      } else if (response.statusCode === 401 || response.statusCode === 403) {
        handleAuthError();
      } else {
        console.error(`Failed to apply coupon: Status ${response.statusCode}`, response.data);
        const errorMessage = response.data?.message || '应用优惠券失败.'; // Translate: Failed to apply coupon
        setCouponError(errorMessage);
        Taro.showToast({ title: errorMessage, icon: 'none' });
      }

    } catch (err) {
      console.error('Network error applying coupon:', err);
      setCouponError('网络错误，无法应用优惠券.'); // Translate: Network error applying coupon
      Taro.showToast({ title: '网络错误', icon: 'none' });
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  // Calculate the final amount to display
  const calculateDisplayTotal = () => {
    let total = order?.finalAmount !== undefined ? order.finalAmount : order?.totalAmount || 0;
    // Add door delivery fee ONLY if it's a non-service-request order AND selected here.
    // For service-request, the door delivery fee is already part of order.finalAmount
    // (calculated when the service-request was created and the order was generated).
    // Also apply for match orders requiring SR setup if door delivery is selected.
    if ((!isOrderTypeServiceRequest || isMatchRequiringSRSetup) && isDoorDeliverySelected) {
      total += DOOR_DELIVERY_FEE;
    }
    return total;
  };

  // --- Function to initiate payment (WeChat Pay Integration) ---
  const handlePay = async () => {
    if (isInitiatingPayment || !order || !selectedPaymentMethod) {
      if (!selectedPaymentMethod) {
        Taro.showToast({ title: '请选择支付方式', icon: 'none' }); // Translate: Please select a payment method
      }
      return;
    }

    // Validate door delivery options if selected AND it's a non-service-request order
    // OR if it's a match order requiring SR setup
    if ((!isOrderTypeServiceRequest || isMatchRequiringSRSetup) && isDoorDeliverySelected) {
      if (!selectedDeliveryAddressId) {
        Taro.showToast({ title: '请选择上门取件地址', icon: 'none' }); // Translate: Please select a door delivery address
        return;
      }
      if (!selectedDeliveryTime) {
        Taro.showToast({ title: '请选择上门取件时间', icon: 'none' }); // Translate: Please select a door delivery time
        return;
      }
    }

    setIsInitiatingPayment(true);
    setError(null);

    const authToken = Taro.getStorageSync('authToken');
    if (!authToken) {
      console.log('No auth token found, preventing payment initiation.');
      setError('您必须登录才能支付.'); // Translate: You must be logged in to pay
      Taro.showToast({ title: '请登录', icon: 'none' });
      setIsInitiatingPayment(false);
      return;
    }

    try {
      // Prepare payload for backend payment initiation endpoint
      const payload = {
        orderId: order._id,
        paymentMethod: selectedPaymentMethod,
        clientCalculatedTotal: calculateDisplayTotal(), // This total includes any optional door delivery fee
      };

      // Conditionally add door delivery details to payload for non-errand orders
      // OR if it's a match order requiring SR setup
      if ((!isOrderTypeServiceRequest || isMatchRequiringSRSetup) && isDoorDeliverySelected) {
        payload.isDoorDeliverySelected = true;
        payload.deliveryAddressId = selectedDeliveryAddressId;
        payload.deliveryTime = selectedDeliveryTime; // This is the time slot string like "0900-1200"
      }

      // NEW: If it's a match order that requires SR setup, include service request details
      if (isMatchRequiringSRSetup) {
        // This should be sent to backend for creating the service request resource
        // The backend will need to determine from/to addresses from the match's resources (resource1, resource2)
        payload.serviceRequestCreationDetails = {
          // Assuming the match order has resource1 (from) and resource2 (to) with address details
          from_address_id: order.resource1?.address?._id, // Assuming address has _id or entire address object
          to_address_id: order.resource2?.address?._id,   // Assuming address has _id or entire address object
          door_delivery: isDoorDeliverySelected,
          // Map the selectedDeliveryTime slot to starting_time or arrival_time as the backend expects
          // For simplicity, let's assume it maps to starting_time
          time_mode: 'starting', // Or dynamically set based on UI if you add more options
          starting_time: selectedDeliveryTime, // Backend will parse this range or you can send e.g., "09:00"
          // If you need arrival_time, define mapping or a separate picker
          // client_surcharge_time: ... (if needed from frontend for new SR creation's pricing)
          // tips: ... (if tips are defined here for this new SR)
        };

        // Validate SR creation details
        if (!payload.serviceRequestCreationDetails.from_address_id || !payload.serviceRequestCreationDetails.to_address_id) {
          Taro.showToast({ title: '无法获取服务请求的起始/目的地址', icon: 'none' });
          setIsInitiatingPayment(false);
          return;
        }
      }


      const response = await Taro.request({
        url: API_BASE_URL + `/api/payment/initiate`,
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: payload, // Use the conditionally built payload
      });

      if (response.statusCode === 200 && response.data && response.data.paymentParams) {
        console.log('Payment initiation successful. Received params:', response.data.paymentParams);

        const paymentParams = response.data.paymentParams;
        Taro.requestPayment({
          timeStamp: paymentParams.timeStamp,
          nonceStr: paymentParams.nonceStr,
          package: paymentParams.package,
          signType: paymentParams.signType || 'MD5',
          paySign: paymentParams.paySign,
          success: (res) => {
            console.log('WeChat Pay success:', res);
            Taro.showToast({ title: '支付成功！', icon: 'success' }); // Translate: Payment Successful!

            // Redirect all successful payments to the orders page
            console.log('Payment successful. Redirecting to orders history.');
            Taro.redirectTo({ url: '/pages/orders/index' });
          },
          fail: (res) => {
            console.error('WeChat Pay failed:', res);
            setError(`支付失败: ${res.errMsg || '未知错误'}`); // Translate: Payment failed: Unknown error
            Taro.showToast({ title: '支付失败', icon: 'none' });
          },
          complete: (res) => {
            console.log('WeChat Pay complete:', res);
            setIsInitiatingPayment(false);
          }
        });
      } else if (response.statusCode === 401 || response.statusCode === 403) {
        handleAuthError();
      } else {
        console.error(`Failed to initiate payment: Status ${response.statusCode}`, response.data);
        const errorMessage = response.data?.message || '发起支付失败.'; // Translate: Failed to initiate payment
        setError(errorMessage);
        Taro.showToast({ title: errorMessage, icon: 'none' });
      }

    } catch (err) {
      console.error('Network error initiating payment request to backend:', err);
      setError('网络错误，无法发起支付.'); // Translate: Network error initiating payment
      Taro.showToast({ title: '网络错误', icon: 'none' });
    } finally {
      // This finally block for the *backend request* is distinct from Taro.requestPayment's complete.
      // The loading state is managed by Taro.requestPayment's callbacks.
    }
  };


  // --- Render ---
  if (isLoadingOrder || isLoadingPaymentMethods || isLoadingUserAddresses) {
    return <View className="order-confirmation-page"><Text>正在加载订单详情...</Text></View>; // Translate: Loading order details...
  }

  if (error) {
    return <View className="order-confirmation-page error-message"><Text>错误: {error}</Text></View>; // Translate: Error:
  }

  if (!order) {
    return <View className="order-confirmation-page"><Text>订单未找到.</Text></View>; // Translate: Order not found.
  }

  // Prepare data for address Picker
  const addressRange = userAddresses.map(addr => {
    const districtName = `区 ${addr.district}`; // You might want a more descriptive mapping for districts
    return {
      label: `${districtName}, ${addr.building} ${addr.unitDetails}`,
      value: addr._id // Use _id as the value
    };
  });
  const selectedAddressIndex = addressRange.findIndex(addr => addr.value === selectedDeliveryAddressId);

  // Prepare data for time slot Picker
  const timeSlotRange = DELIVERY_TIME_SLOTS.map(slot => ({
    label: slot.label,
    value: slot.value
  }));
  const selectedTimeSlotIndex = selectedDeliveryTime ? timeSlotRange.findIndex(slot => slot.value === selectedDeliveryTime) : -1;


  return (
    <View className="order-confirmation-page">
      <ScrollView className="content-container" scrollY>
        <Text className="page-title">确认您的订单</Text> {/* Translate: Confirm Your Order */}

        {/* --- Order Details Section --- */}
        <View className="section">
          <Text className="section-title">订单摘要</Text> {/* Translate: Order Summary */}
          <View className="order-summary-details">
            <Text>订单ID: {order._id}</Text> {/* Translate: Order ID */}
            <Text>状态: {order.status}</Text> {/* Translate: Status */}

            {isOrderTypeServiceRequest ? (
              <>
                <Text>服务类型: 跑腿服务</Text> {/* Translate: Errand Service */}
                {order.resource?.specifications?.from_address && (
                  <Text>从: {order.resource.specifications.from_address.district}, {order.resource.specifications.from_address.building}</Text>
                )}
                {order.resource?.specifications?.to_address && (
                  <Text>到: {order.resource.specifications.to_address.district}, {order.resource.specifications.to_address.building}</Text>
                )}
                {order.resource?.specifications?.door_delivery && (
                  <Text>上门取件: 是</Text>
                )}
                {/* Display Errand-specific time preferences (as text) */}
                {errandTimeMode === 'off' && (
                  <Text>开始时间: 立即开始</Text>
                )}
                {errandTimeMode === 'starting' && errandStartingTime && (
                  <Text>期望开始时间: {errandStartingTime}</Text>
                )}
                {errandTimeMode === 'arrival' && errandArrivalTime && (
                  <Text>期望送达时间: {errandArrivalTime}</Text>
                )}
              </>
            ) : (
              <>
                {/* For 'match' orders or others, show relevant titles/resource names */}
                {order.relevantTitle && <Text>项目: {order.relevantTitle}</Text>} {/* Translate: Item */}
                {/* Or if it's a 'match' type, show resource1 and resource2 details */}
                {order.resource1 && <Text>物品1: {order.resource1.name}</Text>}
                {order.resource2 && <Text>物品2: {order.resource2.name}</Text>}

                {/* NEW: If it's a match requiring SR setup, display its addresses for confirmation */}
                {isMatchRequiringSRSetup && (
                  <>
                    {order.resource1?.address && (
                      <Text>起始地址: {order.resource1.address.district}, {order.resource1.address.building}</Text>
                    )}
                    {order.resource2?.address && (
                      <Text>目的地址: {order.resource2.address.district}, {order.resource2.address.building}</Text>
                    )}
                  </>
                )}
              </>
            )}
          </View>
        </View>

        {/* --- Door Delivery Option (Conditional for non-errand orders OR match orders requiring SR setup) --- */}
        {(!isOrderTypeServiceRequest || isMatchRequiringSRSetup) && (
          <View className="section">
            <Text className="section-title">上门取件 (额外收费 ¥{DOOR_DELIVERY_FEE.toFixed(2)})</Text> {/* Translate: Door Delivery (Extra Charge ¥5.00) */}
            <View className="door-delivery-option">
              <Checkbox
                checked={isDoorDeliverySelected}
                onChange={(e) => setIsDoorDeliverySelected(e.detail.checked)}
                disabled={isInitiatingPayment || userAddresses.length === 0}
              >
                需要上门取件
              </Checkbox> {/* Translate: Require Door Delivery */}
            </View>

            {isDoorDeliverySelected && userAddresses.length === 0 && (
              <Text className="info-message">您还没有保存的地址。请前往个人资料页面添加地址。</Text> // Translate: You have no saved addresses. Please go to profile page to add addresses.
            )}

            {isDoorDeliverySelected && userAddresses.length > 0 && (
              <View className="door-delivery-details">
                <View className='input-container'>
                  <Text className="input-label">选择地址:</Text> {/* Translate: Select Address */}
                  <Picker
                    mode='selector'
                    range={addressRange}
                    rangeKey='label'
                    value={selectedAddressIndex}
                    onChange={(e) => setSelectedDeliveryAddressId(addressRange[e.detail.value].value)}
                    disabled={isInitiatingPayment || userAddresses.length === 0}
                  >
                    <View className='picker-input-field'>
                      <Text>
                        {selectedDeliveryAddressId
                          ? addressRange[selectedAddressIndex]?.label || '请选择地址' // Translate: Please select address
                          : '请选择地址'}
                      </Text>
                    </View>
                  </Picker>
                </View>

                <View className='input-container'>
                  <Text className="input-label">选择取件时间:</Text> {/* Translate: Select Pickup Time */}
                  <Picker
                    mode='selector'
                    range={timeSlotRange}
                    rangeKey='label'
                    value={selectedTimeSlotIndex}
                    onChange={(e) => setSelectedDeliveryTime(timeSlotRange[e.detail.value].value)}
                    disabled={isInitiatingPayment}
                  >
                    <View className='picker-input-field'>
                      <Text>
                        {selectedDeliveryTime
                          ? timeSlotRange[selectedTimeSlotIndex]?.label || '请选择时间段' // Translate: Please select time slot
                          : '请选择时间段'}
                      </Text>
                    </View>
                  </Picker>
                </View>
              </View>
            )}
          </View>
        )}


        {/* --- Coupon Application Section --- */}
        <View className="section">
          <Text className="section-title">应用优惠券</Text> {/* Translate: Apply Coupon */}
          {selectedCoupon ? (
            <View className="applied-coupon">
              <Text>已应用优惠券: {selectedCoupon.code}</Text> {/* Translate: Applied Coupon */}
              <Text className="discount-applied">折扣: -¥{selectedCoupon.discountAmount.toFixed(2)}</Text> {/* Translate: Discount */}
            </View>
          ) : (
            <View className="coupon-input-section">
              <Input
                className="coupon-input"
                placeholder="输入优惠券代码" // Translate: Enter coupon code
                value={couponCode}
                onInput={(e) => setCouponCode(e.detail.value)}
                disabled={isApplyingCoupon}
              />
              <Button
                className="apply-coupon-button"
                onClick={handleApplyCoupon}
                loading={isApplyingCoupon}
                disabled={isApplyingCoupon || !couponCode.trim()}
                size="mini"
              >
                应用
              </Button> {/* Translate: Apply */}
            </View>
          )}
          {couponError && <Text className="coupon-error-message">{couponError}</Text>}
        </View>


        {/* --- Payment Methods Section --- */}
        {!isLoadingPaymentMethods && paymentMethods.length > 0 && (
          <View className="section">
            <Text className="section-title">支付方式</Text> {/* Translate: Payment Method */}
            <View>
              {paymentMethods.map(method => (
                <View key={method.value}
                  className={`payment-method-item ${selectedPaymentMethod === method.value ? 'selected' : ''}`}
                  onClick={() => setSelectedPaymentMethod(method.value)}
                >
                  <Text>{method.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
        {!isLoadingPaymentMethods && paymentMethods.length === 0 && (
          <View className="section"><Text>没有可用的支付方式.</Text></View> // Translate: No payment methods available.
        )}


        {/* --- Final Amount and Pay Button --- */}
        <View className="section final-amount-section">
          <Text className="final-amount">总计: ¥{calculateDisplayTotal().toFixed(2)}</Text> {/* Translate: Total: */}

          <Button
            className="pay-button"
            onClick={handlePay}
            loading={isInitiatingPayment}
            disabled={
              isInitiatingPayment || !order || !selectedPaymentMethod ||
              ((!isOrderTypeServiceRequest || isMatchRequiringSRSetup) && isDoorDeliverySelected && (userAddresses.length === 0 || !selectedDeliveryAddressId || !selectedDeliveryTime))
            }
          >
            {isInitiatingPayment ? '正在处理...' : '立即支付'} {/* Translate: Processing... / Pay Now */}
          </Button>
        </View>

      </ScrollView>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: "确认订单", // Set page title
});
