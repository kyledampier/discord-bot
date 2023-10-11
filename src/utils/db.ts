import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../schema';

export default function getDb(env: Env) {
	return drizzle(env.DB, {
		schema
	});
};