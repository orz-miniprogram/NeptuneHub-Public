export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/request/index',
    'pages/activity/index',
    'pages/orders/index',
    'pages/orders/details/index',
    'pages/orders/orderConfirmation/index',
    'pages/user/index',
    'pages/user/login/index',
    'pages/user/edit/index',
    'pages/user/coupon/index',
    'pages/user/feedback/index',
    'pages/user/wallet/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: 'WeChat',
    navigationBarTextStyle: 'black'
  },
  tabBar: {
    color: '#999999',
    selectedColor: '#2e8b57',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页',
        iconPath: 'assets/tabbar/png/home.png',
        selectedIconPath: 'assets/tabbar/png/home-active.png'
      },
      {
        pagePath: 'pages/request/index',
        text: '发布',
        iconPath: 'assets/tabbar/png/request.png',
        selectedIconPath: 'assets/tabbar/png/request-active.png'
      },
      {
        pagePath: 'pages/activity/index',
        text: '活动',
        iconPath: 'assets/tabbar/png/activity.png',
        selectedIconPath: 'assets/tabbar/png/activity-active.png'
      },
      {
        pagePath: 'pages/orders/index',
        text: '订单',
        iconPath: 'assets/tabbar/png/orders.png',
        selectedIconPath: 'assets/tabbar/png/orders-active.png'
      },
      {
        pagePath: 'pages/user/index',
        text: '我的',
        iconPath: 'assets/tabbar/png/user.png',
        selectedIconPath: 'assets/tabbar/png/user-active.png'
      }
    ]
  }
})
