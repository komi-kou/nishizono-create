const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

class UserManager {
    constructor() {
        // データディレクトリ
        this.dataDir = path.join(__dirname, 'data');
        
        // データファイルのパス
        this.usersFile = path.join(this.dataDir, 'users.json');
        this.settingsFile = path.join(this.dataDir, 'user_settings.json');
        this.dataFile = path.join(this.dataDir, 'user_ad_data.json');
        this.auditFile = path.join(this.dataDir, 'audit_logs.json');
        
        // データディレクトリを作成
        this.ensureDataDirectory();
        
        // ファイルを初期化
        this.initializeFiles();
    }

    // データディレクトリの確保
    ensureDataDirectory() {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            console.log('✅ データディレクトリを作成しました');
        }
    }

    // ファイルの初期化
    initializeFiles() {
        const files = [
            { path: this.usersFile, default: [] },
            { path: this.settingsFile, default: [] },
            { path: this.dataFile, default: [] },
            { path: this.auditFile, default: [] }
        ];

        files.forEach(file => {
            if (!fs.existsSync(file.path)) {
                this.writeJsonFile(file.path, file.default);
                console.log(`✅ ${path.basename(file.path)} を初期化しました`);
            }
        });
    }

    // JSONファイルの安全な読み込み
    readJsonFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                return JSON.parse(data);
            }
            return [];
        } catch (error) {
            console.error(`ファイル読み込みエラー ${filePath}:`, error);
            return [];
        }
    }

    // JSONファイルの安全な書き込み
    writeJsonFile(filePath, data) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
            return true;
        } catch (error) {
            console.error(`ファイル書き込みエラー ${filePath}:`, error);
            return false;
        }
    }

    // ユーザー作成
    async createUser(email, password, username) {
        try {
            console.log('👤 createUser 呼び出し:', { email, username, hasPassword: !!password });
            
            // パラメータバリデーション
            if (!email || typeof email !== 'string' || email.trim() === '') {
                throw new Error('有効なメールアドレスが必要です');
            }
            
            if (!password || typeof password !== 'string') {
                throw new Error('有効なパスワードが必要です');
            }
            
            if (!username || typeof username !== 'string' || username.trim() === '') {
                throw new Error('有効なユーザー名が必要です');
            }
            
            // パスワードの複雑性チェック
            if (password.length < 8) {
                throw new Error('パスワードは8文字以上である必要があります');
            }

            const users = this.readJsonFile(this.usersFile);
            
            // 安全にemail比較
            const normalizedEmail = email.trim().toLowerCase();
            
            // 重複チェック
            const existingUser = users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);
            if (existingUser) {
                throw new Error('このメールアドレスは既に登録されています');
            }

            // パスワードハッシュ化
            const passwordHash = await bcrypt.hash(password, 12);
            
            const userId = uuidv4();
            const newUser = {
                id: userId,
                email: normalizedEmail,
                password_hash: passwordHash,
                username: username.trim(),
                created_at: new Date().toISOString(),
                last_login: null,
                is_active: true,
                login_attempts: 0,
                locked_until: null
            };

            users.push(newUser);
            this.writeJsonFile(this.usersFile, users);

            console.log(`✅ ユーザー作成完了: ${email}`);
            return userId;
        } catch (error) {
            console.error('ユーザー作成エラー:', error);
            throw error;
        }
    }

    // ユーザー認証
    async authenticateUser(email, password) {
        try {
            console.log('🔍 UserManager.authenticateUser 呼び出し:', email, 'type:', typeof email);
            console.log('🔍 password type:', typeof password, 'exists:', !!password);
            
            // パラメータバリデーション
            if (!email || typeof email !== 'string') {
                console.error('❌ email パラメータが無効:', { email, type: typeof email });
                throw new Error('emailパラメータが無効です');
            }
            
            if (!password || typeof password !== 'string') {
                console.error('❌ password パラメータが無効:', { password: !!password, type: typeof password });
                throw new Error('passwordパラメータが無効です');
            }
            
            const users = this.readJsonFile(this.usersFile);
            console.log('📊 ユーザーデータベース読み込み:', users.length + '人');
            
            // 安全にemail.toLowerCase()を実行
            const normalizedEmail = email.trim().toLowerCase();
            console.log('📧 正規化されたemail:', normalizedEmail);
            
            const user = users.find(u => u.email && u.email.toLowerCase() === normalizedEmail && u.is_active);
            console.log('🔍 ユーザー検索結果:', user ? '見つかりました' : '見つかりません');

            if (!user) {
                console.log('❌ 認証失敗: ユーザーが存在しないまたは非アクティブ');
                return null;
            }

            // アカウントロック確認
            if (user.locked_until && new Date(user.locked_until) > new Date()) {
                throw new Error('アカウントが一時的にロックされています');
            }

            // パスワード確認
            console.log('🔑 パスワード検証開始');
            const isValid = await bcrypt.compare(password, user.password_hash);
            console.log('🔑 パスワード検証結果:', isValid ? '一致' : '不一致');
            
            if (isValid) {
                // ログイン成功 - 試行回数リセット
                user.login_attempts = 0;
                user.locked_until = null;
                user.last_login = new Date().toISOString();
                this.writeJsonFile(this.usersFile, users);
                
                console.log(`✅ ログイン成功: ${email} - UserID: ${user.id}`);
                return user.id;
            } else {
                // ログイン失敗 - 試行回数増加
                console.log('❌ パスワード不一致 - 失敗回数増加');
                user.login_attempts = (user.login_attempts || 0) + 1;
                
                if (user.login_attempts >= 5) {
                    user.locked_until = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30分ロック
                    console.log('⚠️ アカウントロック - 30分間');
                }
                
                this.writeJsonFile(this.usersFile, users);
                return null;
            }
        } catch (error) {
            console.error('認証エラー:', error);
            throw error;
        }
    }

    // ユーザー設定取得
    getUserSettings(userId) {
        try {
            // 個別ファイルから読み込み
            const userSettingsPath = path.join(this.dataDir, 'user_settings', `${userId}.json`);
            if (fs.existsSync(userSettingsPath)) {
                const settingsContent = fs.readFileSync(userSettingsPath, 'utf8');
                return JSON.parse(settingsContent);
            }
            
            // 互換性のため、古い形式からも読み込み
            const settings = this.readJsonFile(this.settingsFile);
            return settings.find(s => s.user_id === userId) || null;
        } catch (error) {
            console.error('getUserSettings error:', error);
            return null;
        }
    }

    // ユーザー設定保存
    saveUserSettings(userId, settingsData) {
        try {
            // 個別ファイルディレクトリを確認
            const userSettingsDir = path.join(this.dataDir, 'user_settings');
            if (!fs.existsSync(userSettingsDir)) {
                fs.mkdirSync(userSettingsDir, { recursive: true });
            }
            
            // 個別ファイルに保存
            const userSettingsPath = path.join(userSettingsDir, `${userId}.json`);
            const userSettings = {
                meta_access_token: settingsData.meta_access_token,
                meta_account_id: settingsData.meta_account_id,
                chatwork_api_token: settingsData.chatwork_token || settingsData.chatwork_api_token,
                chatwork_room_id: settingsData.chatwork_room_id,
                service_goal: settingsData.service_goal || '',
                target_cpa: settingsData.target_cpa || '',
                target_cpm: settingsData.target_cpm || '',
                target_ctr: settingsData.target_ctr || '',
                enable_scheduler: settingsData.enable_scheduler !== false,
                schedule_hours: settingsData.schedule_hours || [9, 12, 15, 17, 19],
                enable_chatwork: settingsData.enable_chatwork !== false,
                enable_alerts: settingsData.enable_alerts !== false
            };
            
            fs.writeFileSync(userSettingsPath, JSON.stringify(userSettings, null, 2), 'utf8');
            console.log(`✅ ユーザー設定保存完了 (個別ファイル): ${userSettingsPath}`);
            
            // 互換性のため、古い形式にも保存
            const settings = this.readJsonFile(this.settingsFile);
            const existingIndex = settings.findIndex(s => s.user_id === userId);
            
            const oldFormatSettings = {
                id: existingIndex >= 0 ? settings[existingIndex].id : uuidv4(),
                user_id: userId,
                meta_access_token: settingsData.meta_access_token,
                meta_account_id: settingsData.meta_account_id,
                meta_app_id: settingsData.meta_app_id,
                chatwork_token: settingsData.chatwork_token,
                chatwork_room_id: settingsData.chatwork_room_id,
                service_goal: settingsData.service_goal,
                target_cpa: settingsData.target_cpa,
                target_cpm: settingsData.target_cpm,
                target_ctr: settingsData.target_ctr,
                notifications_enabled: settingsData.notifications_enabled !== false,
                daily_report_enabled: settingsData.daily_report_enabled !== false,
                update_notifications_enabled: settingsData.update_notifications_enabled !== false,
                alert_notifications_enabled: settingsData.alert_notifications_enabled !== false,
                updated_at: new Date().toISOString()
            };

            if (existingIndex >= 0) {
                settings[existingIndex] = oldFormatSettings;
            } else {
                oldFormatSettings.created_at = new Date().toISOString();
                settings.push(oldFormatSettings);
            }

            this.writeJsonFile(this.settingsFile, settings);
            return oldFormatSettings.id;
        } catch (error) {
            console.error('設定保存エラー:', error);
            throw error;
        }
    }

    // ユーザー広告データ保存
    saveUserAdData(userId, adData) {
        try {
            const allData = this.readJsonFile(this.dataFile);
            
            const userAdData = {
                id: uuidv4(),
                user_id: userId,
                date: adData.date || adData.date_start,
                spend: adData.spend,
                impressions: adData.impressions,
                clicks: adData.clicks,
                conversions: adData.conversions,
                ctr: adData.ctr,
                cpm: adData.cpm,
                cpa: adData.cpa,
                budget_rate: adData.budget_rate,
                frequency: adData.frequency,
                alerts: adData.alerts || [],
                created_at: new Date().toISOString()
            };

            allData.push(userAdData);
            
            // 古いデータを削除（ユーザーごとに最新100件まで保持）
            const userDataCount = allData.filter(d => d.user_id === userId).length;
            if (userDataCount > 100) {
                const userDataSorted = allData
                    .filter(d => d.user_id === userId)
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                
                const toKeep = userDataSorted.slice(0, 100);
                const otherUserData = allData.filter(d => d.user_id !== userId);
                
                this.writeJsonFile(this.dataFile, [...otherUserData, ...toKeep]);
            } else {
                this.writeJsonFile(this.dataFile, allData);
            }

            console.log(`✅ ユーザー広告データ保存完了: ${userId}`);
            return userAdData.id;
        } catch (error) {
            console.error('広告データ保存エラー:', error);
            throw error;
        }
    }

    // ユーザー広告データ取得
    getUserAdData(userId, limit = 30) {
        const allData = this.readJsonFile(this.dataFile);
        return allData
            .filter(d => d.user_id === userId)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, limit);
    }

    // 全アクティブユーザー取得（チャットワーク送信用）
    getAllActiveUsers() {
        const users = this.readJsonFile(this.usersFile);
        const fs = require('fs');
        const path = require('path');
        
        return users
            .filter(u => u.is_active)
            .map(user => {
                // ユーザー個別設定を直接ファイルから取得
                const settingsPath = path.join(__dirname, 'data', 'user_settings', `${user.id}.json`);
                let userSettings = {};
                
                try {
                    if (fs.existsSync(settingsPath)) {
                        userSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                    }
                } catch (e) {
                    console.log(`ユーザー設定読み込みエラー: ${user.id}`);
                }
                
                // 正しいフィールド名でチェック
                if (userSettings.enable_chatwork && 
                    userSettings.chatwork_api_token && 
                    userSettings.chatwork_room_id &&
                    userSettings.meta_access_token) {
                    
                    // MultiUserChatworkSenderが期待するフィールドを追加
                    return {
                        ...user,
                        ...userSettings,
                        // 互換性のためのフィールド追加
                        user_id: user.id,
                        daily_report_enabled: userSettings.daily_report_enabled !== false,
                        update_notifications_enabled: userSettings.update_notifications_enabled !== false,
                        alert_notifications_enabled: userSettings.alert_notifications_enabled !== false,
                        chatwork_token: userSettings.chatwork_api_token  // 互換性のため両方設定
                    };
                }
                return null;
            })
            .filter(user => user !== null);
    }

    // 監査ログ記録
    logAuditEvent(userId, action, details, ipAddress, userAgent) {
        try {
            const logs = this.readJsonFile(this.auditFile);
            
            const logEntry = {
                id: uuidv4(),
                user_id: userId,
                action: action,
                details: details,
                ip_address: ipAddress,
                user_agent: userAgent,
                created_at: new Date().toISOString()
            };

            logs.push(logEntry);
            
            // 古いログを削除（最新1000件まで保持）
            if (logs.length > 1000) {
                const sortedLogs = logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                this.writeJsonFile(this.auditFile, sortedLogs.slice(0, 1000));
            } else {
                this.writeJsonFile(this.auditFile, logs);
            }

            return logEntry.id;
        } catch (error) {
            console.error('監査ログエラー:', error);
        }
    }

    // ユーザー情報取得
    getUserById(userId) {
        const users = this.readJsonFile(this.usersFile);
        return users.find(u => u.id === userId) || null;
    }

    // 全ユーザー取得
    getAllUsers() {
        try {
            const users = this.readJsonFile(this.usersFile);
            // アクティブなユーザーのみ返す（設定ファイルが存在するユーザー）
            return users.filter(user => {
                const settingsPath = path.join(this.dataDir, 'user_settings', `${user.id}.json`);
                return fs.existsSync(settingsPath);
            });
        } catch (error) {
            console.error('全ユーザー取得エラー:', error);
            return [];
        }
    }
}

module.exports = UserManager;