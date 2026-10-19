export function validPrices(prices) {
 return ['full','refill'].every(key=>String(prices[key]).trim()!==''&&Number.isFinite(Number(prices[key]))&&Number(prices[key])>=0&&Number(prices[key])<=1000000&&Math.abs(Number(prices[key])*100-Math.round(Number(prices[key])*100))<0.000001);
}
