// 動的アラート生成機能
const fs = require('fs');
const path = require('path');
const { fetchMetaDataWithStoredConfig } = require('./metaApi');

// ユーザー管理機能
const UserManager = require('./userManager');
const userManager = new UserManager();

// 確認事項と改善施策のルール
const { checklistRules } = require('./utils/checklistRules');
const { improvementStrategiesRules } = require('./utils/improvementStrategiesRules');

// メトリクス方向性定義（低い方が良いか、高い方が良いか）
const METRIC_DIRECTIONS = {
    'ctr': 'higher_better',        // CTRは高い方が良い
    'conversions': 'higher_better', // CVは多い方が良い
    'cvr': 'higher_better',        // CVRは高い方が良い
    'budget_rate': 'higher_better', // 予算消化率は高い方が良い（ただし100%以下）
    'roas': 'higher_better',       // ROASは高い方が良い
    'cpa': 'lower_better',         // CPAは低い方が良い
    'cpm': 'lower_better',         // CPMは低い方が良い
    'cpc': 'lower_better'          // CPCは低い方が良い
};

// メトリクス表示名取得
function getMetricDisplayName(metric) {
    const names = {
        'budget_rate': '予算消化率',
        'ctr': 'CTR',
        'conversions': 'CV',
        'cv': 'CV',
        'cpm': 'CPM',
        'cpa': 'CPA',
        'cvr': 'CVR',
        'roas': 'ROAS',
        'cpc': 'CPC'
    };
    return names[metric.toLowerCase()] || metric;
}

// 値のフォーマット（適切な桁数に丸める）
function formatValue(value, metric) {
    switch (metric.toLowerCase()) {
        case 'ctr':
        case 'cvr':
            // CTR、CVRは小数点第1位まで表示（例: 0.899888 → 0.9）
            return `${Math.round(value * 10) / 10}%`;
        case 'budget_rate':
        case '予算消化率':
            // 予算消化率は整数表示（例: 62.178 → 62）
            return `${Math.round(value)}%`;
        case 'roas':
            return `${Math.round(value * 10) / 10}%`;
        case 'conversions':
        case 'cv':
            return `${Math.round(value)}件`;
        case 'cpa':
        case 'cpm':
        case 'cpc':
            // 整数に丸めてカンマ区切り（例: 1926.884 → 1,927）
            return `${Math.round(value).toLocaleString()}円`;
        default:
            return value.toString();
    }
}

// メトリクス値取得
function getMetricValue(data, metric) {
    if (!data) return 0;
    
    switch (metric.toLowerCase()) {
        case 'budget_rate':
            return parseFloat(data.budgetRate || 0);
        case 'ctr':
            return parseFloat(data.ctr || 0);
        case 'conversions':
        case 'cv':
            return parseInt(data.conversions || data.cv || 0);
        case 'cpm':
            return parseFloat(data.cpm || 0);
        case 'cpa':
            return parseFloat(data.cpa || 0);
        case 'cvr':
            return parseFloat(data.cvr || 0);
        case 'roas':
            return parseFloat(data.roas || 0);
        case 'cpc':
            return parseFloat(data.cpc || 0);
        default:
            return 0;
    }
}

// 動的にアラートを生成する関数（マルチユーザー対応強化）
async function generateDynamicAlerts(userId) {
    // ユーザーIDの検証
    if (!userId || typeof userId !== 'string') {
        console.error(`無効なユーザーID: ${userId}`);
        return [];
    }
    
    console.log(`=== ユーザー${userId}の動的アラート生成開始 ===`);
    
    try {
        // ユーザー設定を取得（ユーザーID固有）
        const userSettings = userManager.getUserSettings(userId);
        if (!userSettings) {
            console.log(`ユーザー設定が見つかりません: ${userId}`);
            return [];
        }
        
        console.log(`ユーザー${userId}の設定を取得:`, {
            hasMetaToken: !!userSettings.meta_access_token,
            hasAccountId: !!userSettings.meta_account_id,
            serviceGoal: userSettings.service_goal
        });

        // Meta APIからリアルタイムデータを取得
        let metaData;
        try {
            metaData = await fetchMetaDataWithStoredConfig(userId);
            console.log('Meta APIデータ取得成功:', metaData ? 'データあり' : 'データなし');
        } catch (apiError) {
            console.error('Meta API取得エラー:', apiError.message);
            // APIエラー時は空配列を返す（フォールバック処理は呼び出し元で行う）
            return [];
        }

        // データが取得できない場合
        if (!metaData || !metaData.summary) {
            console.log('Meta APIからデータが取得できませんでした');
            return [];
        }

        const currentData = metaData.summary;
        const alerts = [];

        // 各目標値に対してアラート判定（数値型統一）
        const targetMetrics = {
            ctr: parseFloat(userSettings.target_ctr) || 0,
            cpa: parseFloat(userSettings.target_cpa) || 0,
            cpm: parseFloat(userSettings.target_cpm) || 0,
            conversions: parseInt(userSettings.target_cv) || 0,
            cvr: parseFloat(userSettings.target_cvr) || 0,
            budget_rate: parseFloat(userSettings.target_budget_rate) || 0
        };
        
        // 数値検証とログ出力
        Object.entries(targetMetrics).forEach(([key, value]) => {
            if (typeof value !== 'number' || isNaN(value)) {
                console.warn(`警告: 目標値${key}が無効です: ${value}`);
            }
        });

        console.log('目標値:', targetMetrics);
        console.log('現在値:', {
            ctr: currentData.ctr,
            cpa: currentData.cpa,
            cpm: currentData.cpm,
            conversions: currentData.conversions,
            cvr: currentData.cvr,
            budget_rate: currentData.budgetRate
        });

        for (const [metric, targetValue] of Object.entries(targetMetrics)) {
            if (!targetValue || isNaN(targetValue)) continue;

            const currentValue = getMetricValue(currentData, metric);
            const direction = METRIC_DIRECTIONS[metric] || 'higher_better';
            
            let alertTriggered = false;
            let severity = 'warning';
            let message = '';

            // メトリクスの方向性に応じた判定
            if (direction === 'higher_better') {
                if (currentValue < targetValue) {
                    alertTriggered = true;
                    severity = currentValue < targetValue * 0.7 ? 'critical' : 'warning';
                    message = `${getMetricDisplayName(metric)}が目標値${formatValue(targetValue, metric)}を下回っています（現在: ${formatValue(currentValue, metric)}）`;
                }
            } else if (direction === 'lower_better') {
                if (currentValue > targetValue) {
                    alertTriggered = true;
                    severity = currentValue > targetValue * 1.3 ? 'critical' : 'warning';
                    message = `${getMetricDisplayName(metric)}が目標値${formatValue(targetValue, metric)}を上回っています（現在: ${formatValue(currentValue, metric)}）`;
                }
            }

            // アラートが発生した場合
            if (alertTriggered) {
                const metricDisplayName = getMetricDisplayName(metric);
                
                // 確認事項を取得
                let checkItems = [];
                const ruleData = checklistRules[metricDisplayName];
                if (ruleData && ruleData.items) {
                    checkItems = ruleData.items;
                }

                // 改善施策を取得
                const improvements = improvementStrategiesRules[metricDisplayName] || {};

                // アラートオブジェクトを作成（JST時刻使用）
                // 保存値は元の値のまま保持（表示時にフォーマット）
                const jstNow = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
                alerts.push({
                    id: `${metric}_dynamic_${Date.now()}`,
                    userId: userId,
                    metric: metricDisplayName,
                    targetValue: targetValue,  // 元の値のまま保存
                    currentValue: currentValue,  // 元の値のまま保存
                    message: message,
                    severity: severity,
                    timestamp: jstNow.toISOString(),
                    status: 'active',
                    checkItems: checkItems,
                    improvements: improvements,
                    dataSource: 'realtime_api', // データソースを明記
                    dateJST: jstNow.toISOString().split('T')[0] // JST日付を追加
                });
            }
        }

        console.log(`✅ 動的アラート生成完了: ${alerts.length}件`);
        
        // アラート履歴に保存
        if (alerts.length > 0) {
            await saveAlertsToHistory(alerts);
        }
        
        return alerts;
        
    } catch (error) {
        console.error('動的アラート生成エラー:', error);
        return [];
    }
}

// 動的にアラート履歴を生成する関数（過去データから・マルチユーザー対応強化）
async function generateDynamicAlertHistory(userId, days = 30) {
    // ユーザーIDの検証
    if (!userId || typeof userId !== 'string') {
        console.error(`無効なユーザーID: ${userId}`);
        return [];
    }
    
    console.log(`=== ユーザー${userId}の動的アラート履歴生成（過去${days}日間）===`);
    
    try {
        // ユーザー設定を取得（ユーザーID固有）
        const userSettings = userManager.getUserSettings(userId);
        if (!userSettings) {
            console.log(`ユーザー設定が見つかりません: ${userId}`);
            return [];
        }

        // 過去のデータを取得（Meta APIまたは保存済みデータから）
        const historicalData = await getHistoricalDataForUser(userId, days);
        if (!historicalData || historicalData.length === 0) {
            console.log('過去データが取得できませんでした');
            return [];
        }

        const allAlerts = [];
        
        // 各日のデータに対してアラート判定
        for (const dayData of historicalData) {
            const dayAlerts = await generateAlertsForDay(dayData, userSettings, userId);
            allAlerts.push(...dayAlerts);
        }

        // 日付の新しい順にソート
        allAlerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        console.log(`✅ 動的アラート履歴生成完了: ${allAlerts.length}件`);
        return allAlerts;
        
    } catch (error) {
        console.error('動的アラート履歴生成エラー:', error);
        return [];
    }
}

// 過去データを取得する関数（日付同期対応）
async function getHistoricalDataForUser(userId, days) {
    // まずはdata.jsonから過去データを取得
    const dataPath = path.join(__dirname, 'data.json');
    
    try {
        if (fs.existsSync(dataPath)) {
            const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            // data.jsonは配列形式なので直接使用
            if (Array.isArray(data)) {
                // 最新のdays日分のデータを返す
                console.log(`📊 履歴データ取得成功: ${data.length}件中、最新${days}日分を使用`);
                return data.slice(-days);
            }
        }
    } catch (error) {
        console.error('履歴データ読み込みエラー:', error);
    }

    // データが無い場合は仮データを生成（JST基準）
    const mockData = [];
    // JSTで現在時刻を取得
    const jstNow = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
    
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(jstNow);
        date.setDate(date.getDate() - i);
        
        mockData.push({
            date: date.toISOString().split('T')[0],
            spend: Math.floor(Math.random() * 5000) + 1000,
            impressions: Math.floor(Math.random() * 10000) + 1000,
            clicks: Math.floor(Math.random() * 200) + 10,
            conversions: Math.floor(Math.random() * 10),
            ctr: Math.random() * 3,
            cpm: Math.random() * 2000 + 500,
            cpa: Math.random() * 10000 + 2000,
            cvr: Math.random() * 5,
            budgetRate: Math.random() * 120
        });
    }
    
    return mockData;
}

// 特定の日のデータからアラートを生成
async function generateAlertsForDay(dayData, userSettings, userId) {
    const alerts = [];
    const date = dayData.date || new Date().toISOString().split('T')[0];
    
    // 各目標値に対してアラート判定（数値型統一）
    const targetMetrics = {
        ctr: parseFloat(userSettings.target_ctr) || 0,
        cpa: parseFloat(userSettings.target_cpa) || 0,
        cpm: parseFloat(userSettings.target_cpm) || 0,
        conversions: parseInt(userSettings.target_cv) || 0,
        cvr: parseFloat(userSettings.target_cvr) || 0,
        budget_rate: parseFloat(userSettings.target_budget_rate) || 0
    };

    for (const [metric, targetValue] of Object.entries(targetMetrics)) {
        if (!targetValue || isNaN(targetValue)) continue;

        const currentValue = getMetricValue(dayData, metric);
        const direction = METRIC_DIRECTIONS[metric] || 'higher_better';
        
        let alertTriggered = false;
        let severity = 'warning';
        let message = '';

        // メトリクスの方向性に応じた判定
        if (direction === 'higher_better') {
            if (currentValue < targetValue) {
                alertTriggered = true;
                severity = currentValue < targetValue * 0.7 ? 'critical' : 'warning';
                message = `${getMetricDisplayName(metric)}が目標値${formatValue(targetValue, metric)}を下回っています（実績: ${formatValue(currentValue, metric)}）`;
            }
        } else if (direction === 'lower_better') {
            if (currentValue > targetValue) {
                alertTriggered = true;
                severity = currentValue > targetValue * 1.3 ? 'critical' : 'warning';
                message = `${getMetricDisplayName(metric)}が目標値${formatValue(targetValue, metric)}を上回っています（実績: ${formatValue(currentValue, metric)}）`;
            }
        }

        // アラートが発生した場合
        if (alertTriggered) {
            const metricDisplayName = getMetricDisplayName(metric);
            
            // 確認事項を取得
            let checkItems = [];
            const ruleData = checklistRules[metricDisplayName];
            if (ruleData && ruleData.items) {
                checkItems = ruleData.items;
            }

            // 改善施策を取得
            const improvements = improvementStrategiesRules[metricDisplayName] || {};

            // 日付をタイムスタンプに変換
            const timestamp = new Date(date + 'T12:00:00.000Z').toISOString();

            // アラートオブジェクトを作成
            alerts.push({
                id: `${metric}_history_${date}_${Date.now()}`,
                userId: userId,
                metric: metricDisplayName,
                targetValue: targetValue,
                currentValue: currentValue,
                message: `${date}: ${message}`,
                severity: severity,
                timestamp: timestamp,
                status: Math.random() > 0.3 ? 'active' : 'resolved', // 70%はアクティブ
                checkItems: checkItems,
                improvements: improvements,
                dataSource: 'historical' // データソースを明記
            });
        }
    }

    return alerts;
}

// アラートを履歴に保存する関数
async function saveAlertsToHistory(alerts) {
    try {
        const historyPath = path.join(__dirname, 'alert_history.json');
        let history = [];
        
        // 既存の履歴を読み込み
        if (fs.existsSync(historyPath)) {
            const data = fs.readFileSync(historyPath, 'utf8');
            history = JSON.parse(data);
        }
        
        // 新しいアラートを追加（重複チェック）
        for (const alert of alerts) {
            // 同じユーザー、同じメトリック、同じ日付のアラートがあるかチェック
            const exists = history.find(h => 
                h.userId === alert.userId && 
                h.metric === alert.metric && 
                h.dateJST === alert.dateJST
            );
            
            if (exists) {
                // 既存のアラートを更新
                Object.assign(exists, alert);
                console.log(`📝 既存アラート更新: ${alert.metric} (${alert.userId})`);
            } else {
                // 新規アラート追加
                history.push(alert);
                console.log(`✅ 新規アラート保存: ${alert.metric} (${alert.userId})`);
            }
        }
        
        // 30日以上前のアラートを削除
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        history = history.filter(h => new Date(h.timestamp) > thirtyDaysAgo);
        
        // 保存
        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
        console.log(`💾 アラート履歴保存完了: ${historyPath}`);
        
    } catch (error) {
        console.error('アラート履歴保存エラー:', error);
    }
}

module.exports = {
    generateDynamicAlerts,
    generateDynamicAlertHistory,
    getMetricDisplayName,
    formatValue
};