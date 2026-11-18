/**
 * Reads a setting named ZEVQI_<NAME>, falling back to the older ZLEARN_<NAME>, so setups made before the rename keep working.
 */
export const envVar = (name) => process.env[`ZEVQI_${name}`] || process.env[`ZLEARN_${name}`] || undefined;
