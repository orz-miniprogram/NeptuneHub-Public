import React, { useState, useEffect, definePageConfig } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './index.scss'; // Optional: for styling

// You can keep helper functions outside the component if they are general utilities
// or define them inside if they are only used within this component.
// Let's keep them inside for this example.

export default function MyCouponsPage() {
    const [coupons, setCoupons] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    // Helper function to handle authentication errors and redirect
    const handleAuthError = () => {
        console.warn('Authentication failed, redirecting to login...');
        Taro.removeStorageSync('authToken');
        Taro.removeStorageSync('userId');
        Taro.redirectTo({ url: '/pages/user/login/index' });
    };

    // Helper to format expiry date (adjust format as needed)
    const formatExpiryDate = (dateString) => {
        if (!dateString) return 'No expiry';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            return 'Invalid Date';
        }
        return `Expires: ${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
    };

    // Helper to display discount value
    const displayDiscount = (type, value) => {
        if (type === 'percentage') {
            return `${value}% Off`;
        } else if (type === 'fixed_amount') {
            return `¥${value} Off`; // Adjust currency symbol
        }
        return 'Unknown Discount';
    };

    // Handler to navigate to the page where the coupon can be used
    const handleUseCoupon = (couponId) => {
        console.log('Attempting to use coupon:', couponId);
        // IMPORTANT: Replace '/pages/orderConfirmation/index' with the actual path
        // to your order creation, order confirmation, or payment page.
        Taro.navigateTo({
            url: `/pages/orders/orderConfirmation/index?couponId=${couponId}` // Pass coupon ID as a URL parameter
        });
        // You might also pass the coupon code or other details if needed
        // url: `/pages/orderConfirmation/index?couponCode=${userCoupon.code}`
    };


    // Effect to fetch coupons when the page loads
    useEffect(() => {
        const fetchCoupons = async () => {
            setIsLoading(true);
            setError(null);

            const authToken = Taro.getStorageSync('authToken');
            if (!authToken) {
                console.log('No auth token found, redirecting to login from My Coupons.');
                Taro.showToast({ title: 'Please login to view coupons', icon: 'none' });
                setTimeout(() => {
                    handleAuthError();
                }, 1500);
                return;
            }

            try {
                const response = await Taro.request({
                    url: API_BASE_URL + `/api/user/me/coupons`,
                    method: 'GET',
                    header: {
                        'Authorization': `Bearer ${authToken}`,
                    },
                });

                if (response.statusCode === 200 && response.data && Array.isArray(response.data.coupons)) {
                    setCoupons(response.data.coupons);
                    console.log('Fetched user coupons:', response.data.coupons);
                } else if (response.statusCode === 401 || response.statusCode === 403) {
                    handleAuthError();
                } else {
                    console.error(`Failed to fetch coupons: Status ${response.statusCode}`, response.data);
                    setError('Failed to load coupons.');
                    Taro.showToast({ title: 'Failed to load coupons', icon: 'none' });
                }

            } catch (err) {
                console.error('Network error fetching coupons:', err);
                setError('Network error loading coupons.');
                Taro.showToast({ title: 'Network error', icon: 'none' });
            } finally {
                setIsLoading(false);
            }
        };

        fetchCoupons();

    }, []);

    // --- Render ---

    return (
        <View className="my-coupons-page">
            <Text className="page-title">My Coupons</Text>

            {error && <View className='error-message'>{error}</View>}

            {isLoading && <View>Loading coupons...</View>}

            {!isLoading && !error && coupons.length === 0 && (
                <View>No coupons available.</View>
            )}

            {!isLoading && !error && coupons.length > 0 && (
                <ScrollView
                    className="coupon-list"
                    scrollY
                >
                    {coupons.map(userCoupon => {
                        const coupon = userCoupon.couponDetails;
                        const isExpired = coupon.expiryDate && new Date(coupon.expiryDate) < new Date();

                        return (
                            <View key={userCoupon._id} className={`coupon-item ${isExpired ? 'expired' : ''}`}>
                                <View className="coupon-discount">
                                    <Text className="discount-value">
                                        {displayDiscount(coupon.discountType, coupon.discountValue)}
                                    </Text>
                                    {coupon.minimumOrderAmount > 0 && (
                                        <Text className="min-amount">{`Min Order: ¥${coupon.minimumOrderAmount}`}</Text>
                                    )}
                                </View>
                                <View className="coupon-details">
                                    <Text className="coupon-code">Code: {userCoupon.code}</Text>
                                    {coupon.description && <Text className="coupon-description">{coupon.description}</Text>}
                                    <Text className="coupon-expiry">{formatExpiryDate(coupon.expiryDate)}</Text>
                                    {isExpired && <Text className="coupon-status">Expired</Text>}
                                </View>

                                {/* Add the "Use Now" Button */}
                                {!isExpired && ( // Only show the button if the coupon is not expired
                                    <View className="coupon-action">
                                        <Button
                                            className="use-now-button"
                                            onClick={() => handleUseCoupon(userCoupon._id)} // Pass the UserCoupon ID or code
                                            size="mini" // Make the button smaller
                                        >
                                            Use Now
                                        </Button>
                                    </View>
                                )}

                            </View>
                        );
                    })}
                </ScrollView>
            )}
        </View>
    );
}

definePageConfig({
    navigationBarTitleText: "我的优惠券",
});