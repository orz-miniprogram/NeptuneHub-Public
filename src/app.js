import { useLaunch } from '@tarojs/taro'
import './app.scss'
import './utils/api'

function App({ children }) {
  useLaunch(() => {
    console.log('App launched.')
  })

  return children
}

export default App
