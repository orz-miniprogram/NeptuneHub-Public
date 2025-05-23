import { defineConfig } from '@tarojs/cli';
import react from '@vitejs/plugin-react';
import raw from 'vite-plugin-raw';

// https://taro-docs.jd.com/docs/next/config#defineconfig-辅助函数
export default defineConfig(async (merge, { command, mode }) => {
  console.log("NODE_ENV:", process.env.NODE_ENV);
  const baseConfig = {
    projectName: 'neptune-mini-program',
    date: '2024-3-13',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: [],
    defineConstants: {},
    copy: {
      patterns: [
        {
          from: 'src/assets',
          to: 'dist/assets'
        }
      ],
      options: {}
    },
    framework: 'react',
    compiler: 'vite',
    vite: {
      esbuild: {
        logLevel: 'verbose',
        jsxFactory: 'React.createElement',
        jsxFragment: 'React.Fragment',
      },
      plugins: [
        react({
          babel: {
            plugins: [
              ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }]
            ]
          }
        }),
        raw({
          enforce: 'pre',
          include: [/\.csv$/]
        }),
      ],
    },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
      webpackChain(chain) {
        chain.merge({
          module: {
            rule: {
              svg: {
                test: /\.svg$/,
                use: [{
                  loader: '@svgr/webpack',
                  options: {
                    svgo: false,
                  }
                }]
              }
            }
          }
        })
      }
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      miniCssExtractPluginOption: {
        ignoreOrder: true,
        filename: 'css/[name].[hash].css',
        chunkFilename: 'css/[name].[chunkhash].css',
      },
      postcss: {
        autoprefixer: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
    },
    rn: {
      appName: 'taroDemo',
      postcss: {
        cssModules: {
          enable: false,
        },
      },
    },
  };

  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, {
      defineConstants: {
        API_BASE_URL: JSON.stringify(process.env.API_BASE_URL || 'https://d42b-111-194-208-236.ngrok-free.app/'),
      },
    });
  } else if (process.env.NODE_ENV === 'production') {
    return merge({}, baseConfig, {
      defineConstants: {
        API_BASE_URL: JSON.stringify(process.env.API_BASE_URL || 'https://d42b-111-194-208-236.ngrok-free.app/'),
      },
    });
  } else {
    console.warn("NODE_ENV is not set to 'development' or 'production'. Using production build as default.");
    return merge({}, baseConfig, {
      defineConstants: {
        API_BASE_URL: JSON.stringify(process.env.API_BASE_URL || 'https://d42b-111-194-208-236.ngrok-free.app/'),
      },
    });
  }
});
