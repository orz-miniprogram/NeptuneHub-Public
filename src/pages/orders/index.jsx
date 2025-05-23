// frontend/src/pages/orders/index.jsx

import React, { useEffect, useState, useCallback, definePageConfig } from "react";
import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import TopNavTabs from "../../components/TopNavTabs";
import OrderComponent from "../../components/OrderComponent";
import "./index.scss";
import request from '../../utils/request'; // Assuming you have your request wrapper

export default function Orders() {
  const [activeTab, setActiveTab] = useState("all");
  const [matches, setMatches] = useState([]);
  const [resources, setResources] = useState([]);
  const [errands, setErrands] = useState([]); // New state for errands
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false); // State for disabling buttons during updates

  const tabs = [
    { label: "全部", value: "all" },
    { label: "寻找中", value: "matching" }, // Resources in 'matching'
    { label: "待确认", value: "pending" }, // Matches in 'pending'
    { label: "待支付", value: "accepted" }, // Matches in 'accepted'
    { label: "已支付", value: "paid" },
    { label: "服务中", value: "erranding" }, // Matches in 'erranding', Errands in 'assigned', 'picked_up', 'dropped_off'
    { label: "已完成", value: "completed" },
    { label: "已取消", value: "canceled" },
    { label: "已拒绝", value: "declined" },
  ];

  const handleAuthError = () => {
    console.warn('Authentication failed, redirecting to login...');
    Taro.removeStorageSync('authToken');
    Taro.removeStorageSync('userId');
    Taro.redirectTo({ url: '/pages/user/login/index' });
  };

  // Function to fetch matches for the logged-in user
  const fetchMatches = async (token, statusFilter = "all") => {
    console.log("Fetching matches with status:", statusFilter);
    try {
      let apiUrl = API_BASE_URL + '/api/match';
      if (statusFilter !== "all") {
        apiUrl += '?status=' + statusFilter;
      }

      const response = await request({
        url: apiUrl,
        method: "GET",
        header: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.statusCode === 200 && Array.isArray(response.data)) {
        const matchesWithType = response.data.map((match) => ({
          ...match,
          type: "match", // Add the type field
        }));
        console.log("Matches fetched successfully:", matchesWithType);
        return matchesWithType;
      } else if (response.statusCode === 401 || response.statusCode === 403) {
        handleAuthError();
        throw new Error('Authentication failed');
      } else {
        console.error(`Failed to fetch matches: Status ${response.statusCode}`, response.data);
        throw new Error(`Failed to fetch matches: Status ${response.statusCode}`);
      }
    } catch (err) {
      console.error("Network error fetching matches:", err);
      throw err;
    }
  };

  // Function to fetch resources for the logged-in user
  const fetchResources = async (token, statusFilter = "all") => {
    console.log("Fetching resources with status:", statusFilter);
    try {
      let apiUrl = API_BASE_URL + '/api/resource';
      if (statusFilter !== 'all') {
        apiUrl += '?status=' + statusFilter;
      }

      const response = await request({
        url: apiUrl,
        method: "GET",
        header: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.statusCode === 200 && Array.isArray(response.data)) {
        const resourcesWithType = response.data.map((resource) => ({
          ...resource,
          type: "resource", // Add the type field
        }));
        console.log("Resources fetched successfully:", resourcesWithType);
        return resourcesWithType;
      } else if (response.statusCode === 401 || response.statusCode === 403) {
        handleAuthError();
        throw new Error('Authentication failed');
      } else {
        console.error(`Failed to fetch resources: Status ${response.statusCode}`, response.data);
        throw new Error(`Failed to fetch resources: Status ${response.statusCode}`);
      }
    } catch (err) {
      console.error("Network error fetching resources:", err);
      throw err;
    }
  };

  // Function to fetch errands for the logged-in user
  const fetchErrands = async (token, userId, statusFilter = "all") => { // Add userId as a parameter
    console.log("Fetching errands with status:", statusFilter);
    try {
      let apiUrl = API_BASE_URL + '/api/errand';
      if (statusFilter !== "all") {
        apiUrl += '?status=' + statusFilter;
      }

      const response = await request({
        url: apiUrl,
        method: "GET",
        header: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.statusCode === 200 && Array.isArray(response.data)) {
        const errandsWithType = response.data.map((errand) => ({
          ...errand,
          type: "errand", // Add the type field
        }));
        console.log("Errands fetched successfully:", errandsWithType);
        return errandsWithType;
      } else if (response.statusCode === 401 || response.statusCode === 403) {
        handleAuthError();
        throw new Error('Authentication failed');
      } else {
        console.error(`Failed to fetch errands: Status ${response.statusCode}`, response.data);
        throw new Error(`Failed to fetch errands: Status ${response.statusCode}`);
      }
    } catch (err) {
      console.error("Network error fetching errands:", err);
      throw err;
    }
  };

  // Function to orchestrate fetching data based on activeTab and user status
  const fetchData = async (currentActiveTab) => {
    console.log("fetchData called for tab:", currentActiveTab);
    setIsLoading(true);
    setError(null);
    setResources([]);
    setMatches([]);
    setErrands([]); // Clear previous errand data

    const authToken = Taro.getStorageSync('authToken');

    if (!authToken) {
      console.log('No auth token found, cannot fetch data.');
      handleAuthError();
      setIsLoading(false);
      return;
    }

    let fetchedMatches = [];
    let fetchedResources = [];
    let fetchedErrands = [];
    let fetchError = null;

    const statusFilter = currentActiveTab === 'all' ? 'all' : currentActiveTab;

    try {
      if (currentActiveTab === 'matching') {
        fetchedResources = await fetchResources(authToken, statusFilter).catch(err => { fetchError = err; console.error('Error fetching matching resources:', err); return []; });
      } else if (currentActiveTab === 'all') {
        [fetchedMatches, fetchedResources, fetchedErrands] = await Promise.all([
          fetchMatches(authToken, statusFilter),
          fetchResources(authToken, statusFilter),
          fetchErrands(authToken, statusFilter)
        ]).catch(err => { fetchError = err; console.error('Error fetching all data:', err); return [[], [], []]; });
      } else if (currentActiveTab === 'canceled' || currentActiveTab === 'declined' || currentActiveTab === 'completed') {
        // For these statuses, fetch both matches and resources/errands
        [fetchedMatches, fetchedResources, fetchedErrands] = await Promise.all([
          fetchMatches(authToken, statusFilter),
          fetchResources(authToken, statusFilter),
          fetchErrands(authToken, statusFilter)
        ]).catch(err => { fetchError = err; console.error(`Error fetching ${currentActiveTab} data:`, err); return [[], [], []]; });
      } else if (currentActiveTab === 'erranding') {
        // For 'erranding' tab, fetch matches with 'erranding' status AND errands with specific statuses
        [fetchedMatches, fetchedErrands] = await Promise.all([
          fetchMatches(authToken, statusFilter),
          fetchErrands(authToken, ['assigned', 'picked_up', 'dropped_off']) // Fetch specific errand statuses
        ]).catch(err => { fetchError = err; console.error(`Error fetching 'erranding' data:`, err); return [[], []]; });
      } else {
        // For other Match-specific statuses ('pending', 'accepted', 'paid')
        // Fetch only matches with the specific status
        fetchedMatches = await fetchMatches(authToken, statusFilter).catch(err => { fetchError = err; console.error(`Error fetching matches for status ${currentActiveTab}:`, err); return []; });
      }

      setMatches(fetchedMatches);
      setResources(fetchedResources);
      setErrands(fetchedErrands);

      if (fetchError) {
        setError('Failed to fetch some orders.');
        Taro.showToast({ title: 'Failed to load orders', icon: 'none' });
      }

    } catch (error) {
      console.error("Unexpected error during data fetching orchestration:", error);
      setError('An unexpected error occurred.');
      Taro.showToast({ title: 'An unexpected error occurred', icon: 'none' });
    } finally {
      setIsLoading(false);
      console.log("fetchData process finished.");
    }
  };


  const handleAcceptAndNavigate = (orderId) => {
    console.log('Accept button clicked for order ID:', orderId);
    Taro.navigateTo({
      url: '/pages/orders/orderConfirmation/index?orderId=' + orderId
    });
  };

  const handleViewOrderDetails = (itemId, itemType) => {
    console.log('Viewing order details for ' + itemType + ' ID:', itemId);
    Taro.navigateTo({
      url: '/pages/orders/details/index?id=' + itemId + '&type=' + itemType
    });
  };

  const handleCancelResource = async (resourceId) => {
    console.log('Attempting to cancel resource with ID:', resourceId);
    setIsUpdatingStatus(true); // Start loading state
    try {
      Taro.showLoading({ title: '取消中...' });
      const response = await request({
        url: API_BASE_URL + '/api/resource/' + resourceId,
        method: 'PUT',
        header: {
          'Authorization': 'Bearer ' + Taro.getStorageSync('authToken'),
          'Content-Type': 'application/json',
        },
        data: { status: 'canceled' },
      });

      Taro.hideLoading();

      if (response && typeof response.statusCode !== 'undefined') {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          Taro.showToast({ title: 'Resource canceled successfully', icon: 'success' });
          fetchData(activeTab); // Re-fetch data for the current tab
        } else {
          const errorMessage = response.data?.message || 'Failed to cancel: Status ' + response.statusCode;
          console.error('Resource cancellation failed:', response.statusCode, response.data);
          Taro.showToast({ title: errorMessage, icon: 'none' });
        }
      } else {
        console.error('Resource cancellation received unexpected response structure:', response);
        Taro.showToast({ title: 'Unexpected response from server', icon: 'none' });
      }

    } catch (error) {
      Taro.hideLoading();
      console.error('Network error during resource cancellation:', error);
      Taro.showToast({ title: 'Network error during cancellation', icon: 'none' });
    } finally {
      setIsUpdatingStatus(false); // End loading state
    }
  };

  const handleDeclineMatch = async (matchId) => {
    console.log('Attempting to decline match with ID:', matchId);
    setIsUpdatingStatus(true); // Start loading state
    try {
      Taro.showLoading({ title: '拒绝中...' });
      const response = await request({
        url: API_BASE_URL + '/api/match/' + matchId,
        method: 'PUT',
        header: {
          'Authorization': 'Bearer ' + Taro.getStorageSync('authToken'),
          'Content-Type': 'application/json',
        },
        data: { status: 'declined' },
      });

      Taro.hideLoading();

      if (response && typeof response.statusCode !== 'undefined') {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          Taro.showToast({ title: 'Match declined successfully', icon: 'success' });
          fetchData(activeTab); // Re-fetch data for the current tab
        } else {
          const errorMessage = response.data?.message || 'Failed to decline match: Status ' + response.statusCode;
          console.error('Match decline failed:', response.statusCode, response.data);
          Taro.showToast({ title: errorMessage, icon: 'none' });
        }
      } else {
        console.error('Match decline received unexpected response structure:', response);
        Taro.showToast({ title: 'Unexpected response from server', icon: 'none' });
      }

    } catch (error) {
      Taro.hideLoading();
      console.error('Network error during match decline:', error);
      Taro.showToast({ title: 'Network error during decline', icon: 'none' });
    } finally {
      setIsUpdatingStatus(false); // End loading state
    }
  };

  const handleEditRequest = (resourceId) => {
    console.log('Attempting to edit resource with ID:', resourceId);
    Taro.navigateTo({
      url: '/pages/request/index?id=' + resourceId
    });
  };

  // --- Errand Action Handlers ---
  const handlePickupErrand = async (errandId) => {
    setIsUpdatingStatus(true);
    try {
      const res = await Taro.chooseImage({
        count: 1, // Choose one image
        sizeType: ['compressed'],
        sourceType: ['album', 'camera']
      });

      const tempFilePath = res.tempFilePaths[0];

      if (!tempFilePath) {
        Taro.showToast({ title: '未选择照片', icon: 'none' });
        setIsUpdatingStatus(false);
        return;
      }

      Taro.showLoading({ title: '上传中...' });
      const token = Taro.getStorageSync('authToken');

      const uploadRes = await Taro.uploadFile({
        url: API_BASE_URL + '/api/errand/' + errandId + '/pickup',
        filePath: tempFilePath,
        name: 'pickupProof', // Must match the field name in your Multer configuration
        header: {
          'Authorization': `Bearer ${token}`,
        },
        formData: {
          // Any additional form data you want to send
        }
      });

      Taro.hideLoading();

      if (uploadRes.statusCode === 200 || uploadRes.statusCode === 201) {
        Taro.showToast({ title: '取货成功', icon: 'success' });
        fetchData(activeTab); // Refresh order list
      } else {
        let errorData = {};
        try {
          errorData = JSON.parse(uploadRes.data); // Taro.uploadFile data is a string, needs parsing
        } catch (e) {
          errorData = { message: '未知错误' };
        }
        Taro.showToast({ title: `取货失败: ${errorData.message || '服务器错误'}`, icon: 'none' });
        console.error('Upload failed:', uploadRes);
      }

    } catch (error) {
      Taro.hideLoading();
      console.error('Error during pickup process:', error);
      Taro.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleDropoffErrand = async (errandId) => {
    setIsUpdatingStatus(true);
    try {
      const res = await Taro.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera']
      });

      const tempFilePath = res.tempFilePaths[0];

      if (!tempFilePath) {
        Taro.showToast({ title: '未选择照片', icon: 'none' });
        setIsUpdatingStatus(false);
        return;
      }

      Taro.showLoading({ title: '上传中...' });
      const token = Taro.getStorageSync('authToken');

      const uploadRes = await Taro.uploadFile({
        url: API_BASE_URL + '/api/errand/' + errandId + '/dropoff',
        filePath: tempFilePath,
        name: 'dropoffProof', // Must match the field name in your Multer configuration
        header: {
          'Authorization': `Bearer ${token}`,
        },
        formData: {
          // Any additional form data you want to send
        }
      });

      Taro.hideLoading();

      if (uploadRes.statusCode === 200 || uploadRes.statusCode === 201) {
        Taro.showToast({ title: '送达成功', icon: 'success' });
        fetchData(activeTab); // Refresh order list
      } else {
        let errorData = {};
        try {
          errorData = JSON.parse(uploadRes.data);
        } catch (e) {
          errorData = { message: '未知错误' };
        }
        Taro.showToast({ title: `送达失败: ${errorData.message || '服务器错误'}`, icon: 'none' });
        console.error('Upload failed:', uploadRes);
      }

    } catch (error) {
      Taro.hideLoading();
      console.error('Error during dropoff process:', error);
      Taro.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleCompleteErrand = async (errandId) => {
    setIsUpdatingStatus(true);
    try {
      Taro.showLoading({ title: '提交中...' });
      const token = Taro.getStorageSync('authToken');
      const response = await request({
        url: API_BASE_URL + '/api/errand/' + errandId + '/complete',
        method: 'PUT',
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      Taro.hideLoading();

      if (response.statusCode >= 200 && response.statusCode < 300) {
        Taro.showToast({ title: '订单已完成', icon: 'success' });
        fetchData(activeTab); // Refresh order list
      } else {
        Taro.showToast({ title: `完成失败: ${response.data?.message || '服务器错误'}`, icon: 'none' });
        console.error('Complete errand failed:', response);
      }
    } catch (error) {
      Taro.hideLoading();
      console.error('Error completing errand:', error);
      Taro.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      setIsUpdatingStatus(false);
    }
  };
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
  }, []);


  // --- Effects ---

  // Effect to set initial tab and fetch data on mount
  useEffect(() => {
    console.log("useEffect: component mounted, reading URL params and setting tab.");
    const routerParams = Taro.getCurrentInstance().router?.params;
    const initialTab = routerParams?.tab || "all";

    setActiveTab(initialTab); // Set the initial tab state.
  }, []);

  // Effect to fetch data whenever activeTab state changes
  useEffect(() => {
    console.log("useEffect: activeTab state updated to", activeTab, "triggering fetchData.");
    const userId = Taro.getStorageSync('userId');
    const authToken = Taro.getStorageSync('authToken');

    if (userId && authToken) {
      fetchData(activeTab);
    } else {
      console.log('User not logged in, cannot fetch data for orders.');
      handleAuthError();
    }

  }, [activeTab]); // Re-run effect ONLY when activeTab state changes


  // Effect to process fetched matches, resources, and errands into orders for display
  useEffect(() => {
    console.log("useEffect: matches, resources, or errands state updated, combining and processing.");

    let combinedOrders = [];

    // Combine logic based on the active tab
    if (activeTab === "matching") {
      combinedOrders = resources && Array.isArray(resources) ? [...resources] : [];
    } else if (activeTab === "erranding") {
      combinedOrders = [...(matches || []), ...(errands || [])];
    } else { // All other tabs ('all', 'canceled', 'pending', etc.)
      combinedOrders = [...(matches || []), ...(resources || []), ...(errands || [])];
    }

    // Sort combined orders by creation date (optional, but good practice)
    combinedOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    console.log("Final combined and sorted orders:", combinedOrders);
    setOrders(combinedOrders);
    console.log("Orders state updated for rendering.");

  }, [matches, resources, errands, activeTab]);


  // Handler for tab change (in Orders.jsx)
  const handleTabChange = (tabValue) => {
    console.log("handleTabChange in Orders.jsx:", tabValue);
    // Update the active tab state in the page
    setActiveTab(tabValue);

    // Optional: Update the URL query parameter to reflect the active tab
    Taro.redirectTo({
      url: '/pages/orders/index?tab=' + tabValue
    });
  };


  // --- Render ---

  return (
    <View className="orders-page">
      <TopNavTabs
        tabs={tabs}
        pagePath="/pages/orders/index"
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />
      <View className="order-list-container">
        {isLoading ? (
          <View className="loading-message">Loading orders...</View>
        ) : error ? (
          <View className="error-message">Error loading orders: {error}</View>
        ) : orders && orders.length > 0 ? (
          orders.map((order) => (
            <OrderComponent
              key={order._id || order.id}
              order={order}
              onAccept={handleAcceptAndNavigate}
              handleCancelResource={handleCancelResource}
              handleDeclineMatch={handleDeclineMatch}
              handleEditRequest={handleEditRequest}
              handlePickupErrand={handlePickupErrand}
              handleDropoffErrand={handleDropoffErrand}
              handleCompleteErrand={handleCompleteErrand}
              handleCompleteMatch={handleCompleteMatch}
              onClick={() => handleViewOrderDetails(order._id, order.type)}
              currentUserId={Taro.getStorageSync('userId')}
              isUpdatingStatus={isUpdatingStatus}
            />
          ))
        ) : (
          <View className="no-orders-message">No orders found for this status.</View>
        )}
        {!isLoading && !error && orders && orders.length > 0 && (
          <Text className="end-message">到底了，仅展示近一年订单</Text>
        )}
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: "订单",
});
