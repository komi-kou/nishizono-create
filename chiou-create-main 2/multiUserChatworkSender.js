const UserManager = require('../userManager');
const { sendChatworkMessage } = require('../chatworkApi');
const { fetchMetaAdDailyStats } = require('../metaApi');

class MultiUserChatworkSender {
    constructor() {
        this.userManager = new UserManager();
        this.sentHistory = new Map(); // メモリ内送信履歴
    }

    // 全ユーザーの設定を取得
    getAllActiveUsers() {
        return this.userManager.getAllActiveUsers();
    }

    // 送信履歴チェック（ユーザー別）
    checkUserSentHistory(userId, type, date = null) {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const currentHour = now.getHours();
        const key = `${userId}_${type}_${date || today}_${currentHour}`;
        
        if (this.sentHistory.has(key)) {
            console.log(`⚠️ ユーザー${userId}の${type}は既に送信済み: ${key}`);
            return false;
        }
        
        this.sentHistory.set(key, new Date().toISOString());
        console.log(`✅ ユーザー${userId}の${type}送信履歴を記録: ${key}`);
        return true;
    }

    // ユーザー別日次レポート送信
    async sendUserDailyReport(userSettings) {
        try {
            if (!userSettings.daily_report_enabled) {
                console.log(`ユーザー${userSettings.user_id}: 日次レポート無効`);
                return;
            }

            if (!this.checkUserSentHistory(userSettings.user_id, 'daily')) {
                return;
            }

            console.log(`📅 ユーザー${userSettings.user_id}の日次レポート送信開始`);

            // ユーザーのMeta広告データを取得
            const metaData = await fetchMetaAdDailyStats({
                accessToken: userSettings.meta_access_token,
                accountId: userSettings.meta_account_id,
                datePreset: 'yesterday'
            });

            if (!metaData || metaData.length === 0) {
                console.log(`ユーザー${userSettings.user_id}: データなし`);
                return;
            }

            const data = metaData[0];
            const yesterdayStr = new Date(Date.now() - 24 * 60 * 60 * 1000)
                .toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' });

            // ユーザー別データベースに保存
            this.userManager.saveUserAdData(userSettings.user_id, data);

            // チャットワークメッセージを生成（数値を適切に丸める）
            const message = `Meta広告 日次レポート (${yesterdayStr})

消化金額（合計）：${Math.round(data.spend || 0).toLocaleString()}円
予算消化率（平均）：${Math.round(data.budgetRate || 0)}%
CTR（平均）：${Math.round((data.ctr || 0) * 10) / 10}%
CPM（平均）：${Math.round(data.cpm || 0).toLocaleString()}円 
CPA（平均）：${Math.round(data.cpa || 0).toLocaleString()}円
フリークエンシー（平均）：${Math.round((data.frequency || 0) * 10) / 10}
コンバージョン数：${Math.round(data.conversions || 0)}件  

確認はこちら
https://meta-ads-dashboard.onrender.com/dashboard`;

            // チャットワークに送信
            await sendChatworkMessage({
                date: yesterdayStr,
                message: message,
                token: userSettings.chatwork_token,
                room_id: userSettings.chatwork_room_id
            });

            console.log(`✅ ユーザー${userSettings.user_id}の日次レポート送信完了`);

        } catch (error) {
            console.error(`❌ ユーザー${userSettings.user_id}の日次レポート送信エラー:`, error);
        }
    }

    // ユーザー別定期更新通知送信
    async sendUserUpdateNotification(userSettings) {
        try {
            if (!userSettings.update_notifications_enabled) {
                console.log(`ユーザー${userSettings.user_id}: 定期更新通知無効`);
                return;
            }

            if (!this.checkUserSentHistory(userSettings.user_id, 'update')) {
                return;
            }

            console.log(`🔄 ユーザー${userSettings.user_id}の定期更新通知送信開始`);

            const message = `Meta広告 定期更新通知
数値を更新しました。
ご確認よろしくお願いいたします！

確認はこちら
https://meta-ads-dashboard.onrender.com/dashboard`;

            await sendChatworkMessage({
                date: new Date().toISOString().split('T')[0],
                message: message,
                token: userSettings.chatwork_token,
                room_id: userSettings.chatwork_room_id
            });

            console.log(`✅ ユーザー${userSettings.user_id}の定期更新通知送信完了`);

        } catch (error) {
            console.error(`❌ ユーザー${userSettings.user_id}の定期更新通知送信エラー:`, error);
        }
    }

    // ユーザー別アラート通知送信
    async sendUserAlertNotification(userSettings) {
        try {
            if (!userSettings.alert_notifications_enabled) {
                console.log(`ユーザー${userSettings.user_id}: アラート通知無効`);
                return;
            }

            if (!this.checkUserSentHistory(userSettings.user_id, 'alert')) {
                return;
            }

            console.log(`🚨 ユーザー${userSettings.user_id}のアラート通知チェック開始`);

            // 改善施策2: アラート履歴から最新データを取得（自動的に目標値が更新される）
            const { getAlertHistory } = require('../alertSystem');
            const alertHistory = await getAlertHistory(userSettings.user_id);
            
            // アクティブなアラートのみ抽出
            const activeAlerts = alertHistory.filter(alert => alert.status === 'active');
            
            if (activeAlerts.length === 0) {
                console.log(`ユーザー${userSettings.user_id}: アクティブなアラートなし`);
                return;
            }

            // 値のフォーマット用関数（適切な桁数に丸める）
            const formatValue = (value, metric) => {
                switch (metric.toLowerCase()) {
                    case 'ctr':
                    case 'cvr':
                        // CTR、CVRは小数点第1位まで表示（例: 0.899888 → 0.9）
                        return `${Math.round(value * 10) / 10}%`;
                    case 'budget_rate':
                    case '予算消化率':
                        // 予算消化率は整数表示（例: 62.178 → 62）
                        return `${Math.round(value)}%`;
                    case 'conversions':
                    case 'cv':
                        return `${Math.round(value)}件`;
                    case 'cpa':
                    case 'cpm':
                    case 'cpc':
                        // 整数に丸めてカンマ区切り（例: 1926.884 → 1,927）
                        return `${Math.round(value).toLocaleString('ja-JP')}円`;
                    default:
                        return value.toString();
                }
            };

            // メトリクス表示名取得
            const getMetricDisplayName = (metric) => {
                const names = {
                    'budget_rate': '予算消化率',
                    'ctr': 'CTR',
                    'conversions': 'CV',
                    'cv': 'CV',
                    'cpm': 'CPM',
                    'cpa': 'CPA',
                    'cvr': 'CVR',
                    'cpc': 'CPC'
                };
                return names[metric.toLowerCase()] || metric;
            };

            // アラートメッセージを構築
            const dateStr = new Date().toLocaleDateString('ja-JP');
            let message = `[info][title]Meta広告 アラート通知 (${dateStr})[/title]\n`;
            message += `以下の指標が目標値から外れています：\n\n`;

            // 重要度順にソート
            const sortedAlerts = activeAlerts.sort((a, b) => {
                if (a.severity === 'critical' && b.severity !== 'critical') return -1;
                if (a.severity !== 'critical' && b.severity === 'critical') return 1;
                return 0;
            });

            // 上位10件のアラートを表示
            sortedAlerts.slice(0, 10).forEach((alert, index) => {
                const icon = alert.severity === 'critical' ? '🔴' : '⚠️';
                const metricName = getMetricDisplayName(alert.metric);
                message += `${icon} ${metricName}: `;
                message += `目標 ${formatValue(alert.targetValue, alert.metric)} → `;
                message += `実績 ${formatValue(alert.currentValue, alert.metric)}\n`;
            });

            if (sortedAlerts.length > 10) {
                message += `\n...他${sortedAlerts.length - 10}件のアラート\n`;
            }

            message += `\n📊 詳細はダッシュボードでご確認ください：\n`;
            message += `http://localhost:3000/dashboard\n\n`;
            message += `✅ 確認事項：http://localhost:3000/improvement-tasks\n`;
            message += `💡 改善施策：http://localhost:3000/improvement-strategies[/info]`;

            await sendChatworkMessage({
                date: new Date().toISOString().split('T')[0],
                message: message,
                token: userSettings.chatwork_token,
                room_id: userSettings.chatwork_room_id
            });

            console.log(`✅ ユーザー${userSettings.user_id}のアラート通知送信完了（${activeAlerts.length}件のアラート）`);

        } catch (error) {
            console.error(`❌ ユーザー${userSettings.user_id}のアラート通知送信エラー:`, error);
        }
    }

    // 全ユーザーに日次レポート送信
    async sendDailyReportToAllUsers() {
        try {
            const activeUsers = this.getAllActiveUsers();
            console.log(`📅 ${activeUsers.length}人のユーザーに日次レポート送信開始`);

            for (const user of activeUsers) {
                await this.sendUserDailyReport(user);
                // 送信間隔を空ける（レート制限対策）
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            console.log('✅ 全ユーザーの日次レポート送信完了');
        } catch (error) {
            console.error('❌ 日次レポート一括送信エラー:', error);
        }
    }

    // 全ユーザーに定期更新通知送信
    async sendUpdateNotificationToAllUsers() {
        try {
            const activeUsers = this.getAllActiveUsers();
            console.log(`🔄 ${activeUsers.length}人のユーザーに定期更新通知送信開始`);

            for (const user of activeUsers) {
                await this.sendUserUpdateNotification(user);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            console.log('✅ 全ユーザーの定期更新通知送信完了');
        } catch (error) {
            console.error('❌ 定期更新通知一括送信エラー:', error);
        }
    }

    // 全ユーザーにアラート通知送信
    async sendAlertNotificationToAllUsers() {
        try {
            const activeUsers = this.getAllActiveUsers();
            console.log(`🚨 ${activeUsers.length}人のユーザーにアラート通知送信開始`);

            for (const user of activeUsers) {
                await this.sendUserAlertNotification(user);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            console.log('✅ 全ユーザーのアラート通知送信完了');
        } catch (error) {
            console.error('❌ アラート通知一括送信エラー:', error);
        }
    }

}

module.exports = MultiUserChatworkSender;