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
  const { owner } = req.query;

  if (!owner || typeof owner !== 'string') {
    return res.status(400).json({ error: 'Missing wallet address' });
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'Solana Tracker API key not configured. Please add SOLANATRACKER_API_KEY to .env.local' });
  }

  try {
    await runMiddleware(req, res, limiter);
  } catch (error) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  try {
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
    
    // Transform the data to match our expected format
    const walletData = {
      tokens: data.tokens.map((token: any) => ({
        mint: token.token.mint,
        name: token.token.name,
        symbol: token.token.symbol,
        decimals: token.token.decimals || 9,
        logoURI: token.token.image,
        price: token.price || 0,
        value: token.value || 0,
        risk: token.risk?.risk || 0,
        riskDetails: token.risk?.details || null,
        eventDetails: token.event?.another_details || null
      }))
    };

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