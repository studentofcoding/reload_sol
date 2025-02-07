import type { NextApiRequest, NextApiResponse } from 'next';
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 1000, // 1 second
  max: 1 // limit each IP to 1 request per windowMs
});

const API_KEY = process.env.API_KEY;
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
  const { mintAddress } = req.query;

  if (!mintAddress || typeof mintAddress !== 'string') {
    return res.status(400).json({ error: 'Missing mint address' });
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    await runMiddleware(req, res, limiter);
  } catch (error) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  try {
    const response = await fetch(
      `${BASE_URL}/tokens/${mintAddress}`,
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
    const tokenData = {
      address: mintAddress,
      chainId: 101, // Solana mainnet
      decimals: data.decimals || 9,
      name: data.name || 'Unknown Token',
      symbol: data.symbol || 'UNKNOWN',
      logoURI: data.image || null,
      price: data.price || 0,
      tags: [],
      extensions: {
        coingeckoId: data.coingeckoId,
        website: data.website,
        twitter: data.twitter
      }
    };

    res.setHeader('Cache-Control', 's-maxage=60'); // Cache for 60 seconds
    res.status(200).json(tokenData);
  } catch (error) {
    console.error('Token fetch error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch token data',
      details: error.message 
    });
  }
} 