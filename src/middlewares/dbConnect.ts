import type { Request, Response, NextFunction } from 'express'
import { connectDB } from '../config/db'
import { loadApiSettings } from '../services/apiSettings'

// Har request se pehle yakeeni banata hai ke MongoDB connected hai
export async function dbConnect(
  _req: Request,
  _res: Response,
  next: NextFunction,
) {
  await connectDB()
  // Dashboard mein lagi API keys / settings (30 second cache)
  await loadApiSettings()
  next()
}
