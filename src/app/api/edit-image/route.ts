import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    console.log('=== API Route Start ===');
    
    const { image, prompt } = await request.json();
    
    if (!image || !prompt) {
      return NextResponse.json({ 
        error: '画像と編集指示が必要です' 
      }, { status: 400 });
    }

    if (!process.env.OPENROUTER_API_KEY) {
      console.error('Environment Variables Missing');
      return NextResponse.json({ 
        error: 'OpenRouter APIキーが設定されていません',
        solution: '.env.localファイルにOPENROUTER_API_KEYを設定してサーバーを再起動してください'
      }, { status: 500 });
    }

    console.log('Calling OpenRouter API...');

    const apiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
        'X-Title': 'Gemini Image Editor'
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image-preview:free",
        messages: [{
          role: 'user',
          content: [
            { 
              type: 'text', 
              text: `この画像を「${prompt}」という指示で編集してください。3つの異なるバリエーションで高品質な画像を生成してください。広告用途に適しており、指示を忠実に反映したものにしてください。`
            },
            { 
              type: 'image_url', 
              image_url: { url: `data:image/jpeg;base64,${image}` }
            }
          ]
        }],
        modalities: ["image", "text"],
        temperature: 0.7
      })
    });

    console.log('OpenRouter Status:', apiResponse.status);

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error('OpenRouter Error:', errorText);
      
      let userMessage = 'API呼び出しエラー';
      if (apiResponse.status === 401) {
        userMessage = 'APIキーが無効です。OpenRouter.aiで新しいキーを生成してください';
      } else if (apiResponse.status === 429) {
        userMessage = '無料枠上限(50回/日)に達しました。$10購入で1000回/日に拡張できます';
      } else if (apiResponse.status === 402) {
        userMessage = 'アカウントクレジット不足です';
      }
      
      return NextResponse.json({ 
        error: userMessage,
        status: apiResponse.status,
        details: errorText
      }, { status: apiResponse.status });
    }

    const responseData = await apiResponse.json();
    console.log('OpenRouter Success:', JSON.stringify(responseData, null, 2));
    
    return NextResponse.json({ 
      success: true, 
      response: responseData
    });

  } catch (error) {
    console.error('Route Error:', error);
    return NextResponse.json({ 
      error: 'サーバーエラー',
      details: error instanceof Error ? error.message : '不明なエラー'
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ 
    status: 'API動作中',
    model: 'google/gemini-2.5-flash-image-preview:free',
    hasApiKey: !!process.env.OPENROUTER_API_KEY
  });
}