import type { NextApiRequest, NextApiResponse } from 'next';
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 1000, // 1 second
  max: 1 // limit each IP to 1 request per windowMs
});

const API_KEY = process.env.SOLANATRACKER_API_KEY;
const BASE_URL = 'https://data.solanatracker.io';

// Helper to run rate limiter
const runMiddleware = (req: NextApiRequest, res: NextApiResponse, fn: Function) => {
  return new Promise((resolve, reject) => {
    fn(req, res, (result: any) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  console.log('Handling wallet request:', req.query);
  const { owner } = req.query;

  if (!owner || typeof owner !== 'string') {
    console.log('Invalid owner:', owner);
    return res.status(400).json({ error: 'Missing wallet address' });
  }

  if (!API_KEY) {
    console.log('Missing API key');
    return res.status(500).json({ error: 'Solana Tracker API key not configured. Please add SOLANATRACKER_API_KEY to .env.local' });
  }

  try {
    console.log('Applying rate limit for:', owner);
    await runMiddleware(req, res, limiter);
  } catch (error) {
    console.log('Rate limit exceeded for:', owner);
    return res.status(429).json({ error: 'Too many requests' });
  }

  try {
    console.log('Fetching data from Solana Tracker for:', owner);
    const response = await fetch(
      `${BASE_URL}/wallet/${owner}`,
      {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Error: ${response.status}`, errorText);
      throw new Error(`API responded with status ${response.status}`);
    }

    const data = await response.json();
    console.log('Received data for:', owner, 'token count:', data.tokens.length);
    
    // Transform the data to match our expected format
    const walletData = {
      tokens: data.tokens.map((token: any) => ({
        mint: token.token.mint,
        name: token.token.name,
        symbol: token.token.symbol,
        decimals: token.token.decimals || 9,
        logoURI: token.token.image,
        balance: token.balance || 0,
        value: token.value || 0,
        risk: token.risk || 0,
      }))
    };

    console.log('Transformed data for:', owner, 'token count:', walletData.tokens.length);
    console.log('Full wallet data:', JSON.stringify(walletData, null, 2));
    console.log('Token details:');
    walletData.tokens.forEach((token, index) => {
      console.log(`Token ${index + 1}:`, {
        mint: token.mint,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        logoURI: token.logoURI,
        balance: token.balance,
        value: token.value,
        risk: token.risk
      });
    });

    res.setHeader('Cache-Control', 's-maxage=60'); // Cache for 60 seconds
    res.status(200).json(walletData);
  } catch (error: any) {
    console.error('Wallet data fetch error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch wallet data',
      details: error.message 
    });
  }
} 