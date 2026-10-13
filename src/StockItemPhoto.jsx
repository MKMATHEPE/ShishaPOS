const STOCK_PHOTOS = {
  Coal: '/brand/coal.jpg',
  'Mouth Pieces': '/brand/mouth-pieces.jpg',
};

export default function StockItemPhoto({ name, fallback = null }) {
  const src = STOCK_PHOTOS[name];
  return src ? <img className="stock-item-photo" src={src} alt="" width="32" height="38" decoding="async" /> : fallback;
}
