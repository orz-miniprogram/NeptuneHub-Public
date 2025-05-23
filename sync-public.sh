#!/bin/bash

# Enable debug output
set -x

# Repository URLs - Replace these with your actual repositories
PRIVATE_REPO="git@github.com:orz-miniprogram/NeptuneHub.git"
PUBLIC_REPO="git@github.com:orz-miniprogram/NeptuneHub-Public.git"
WORKDIR="$USERPROFILE/AppData/Local/Temp/neptune-sync"

echo "Starting sync process..."
echo "Working directory will be: $WORKDIR"

# Clean up and clone
echo "Cleaning up old directory if it exists..."
rm -rf "$WORKDIR"

echo "Cloning private repository..."
git clone $PRIVATE_REPO "$WORKDIR"
if [ $? -ne 0 ]; then
    echo "Failed to clone private repository!"
    read -p "Press Enter to continue..."
    exit 1
fi

echo "Changing to working directory..."
cd "$WORKDIR" || {
    echo "Failed to change to working directory!"
    read -p "Press Enter to continue..."
    exit 1
}

echo "Removing sensitive files..."
# Remove sensitive and unnecessary files/directories
rm -rf .env \
       .github/workflows/* \
       .vs \
       node_modules \
       uploads/* \
       dist/* \
       .git/hooks/*

echo "Creating public config files..."
# Create public versions of config files
cat > config/dev.js << EOL
export default {
  // Public development configuration
  // Add non-sensitive defaults here
}
EOL

cat > config/prod.js << EOL
export default {
  // Public production configuration
  // Add non-sensitive defaults here
}
EOL

echo "Creating public README..."
# Create a public README version
cat > README.md << EOL
# Neptune 小程序

## 项目简介
Neptune 是一个由学生为学生打造的资源流动平台。我们的目标是让闲置资源流动起来，没有大公司的参与，完全由我们学生自己塑造生态系统。

## 技术栈
- 前端：React + Taro
- 后端：Node.js
- 数据库：MongoDB
- 消息队列：Redis
- 其他：Python（部分功能）

## 环境要求
- Node.js
- npm 或 yarn
- 微信开发者工具
- Docker（仅Python后端开发需要）

## 开发指南
请参考各目录下的文档进行开发环境配置。

## 贡献指南
欢迎提交 Pull Request 或创建 Issue 来帮助改进项目。

## 许可证
[待补充]

## 注意
这是 Neptune 小程序的公开版本仓库。出于安全考虑，部分配置和敏感信息已被移除。
EOL

echo "Initializing new git repository..."
# Initialize new git repo and push to public
rm -rf .git
git init
if [ $? -ne 0 ]; then
    echo "Failed to initialize git repository!"
    read -p "Press Enter to continue..."
    exit 1
fi

# Set up master branch explicitly
git checkout -b master

echo "Adding files to git..."
git add .

echo "Configuring git user if not set..."
if [ -z "$(git config user.email)" ]; then
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git config user.name "GitHub Actions Bot"
fi

echo "Committing changes..."
git commit -m "Sync public version"
if [ $? -ne 0 ]; then
    echo "Failed to commit changes!"
    read -p "Press Enter to continue..."
    exit 1
fi

echo "Adding remote repository..."
git remote add origin $PUBLIC_REPO

echo "Pushing to public repository..."
git push -f origin master
if [ $? -ne 0 ]; then
    echo "Failed to push to public repository!"
    read -p "Press Enter to continue..."
    exit 1
fi

echo "Public sync completed!"
echo "Press Enter to close this window..."
read -p "" 