// src/constants/stock.constants.ts
export enum StockChangeType {
      OTHER = 0,         // 其他
      STOCK_IN = 1,      // 入库
      STOCK_OUT = 2,     // 出库
      ORDER_LOCK = 3,    // 订单锁定
      ORDER_RELEASE = 4, // 订单释放
      STOCK_TAKE_UP = 5, // 盘点增加
      STOCK_TAKE_DOWN = 6, // 盘点减少
  }
  
  // 库存变更类型标签映射
  export const stockChangeTypeLabels: Record<StockChangeType, string> = {
      [StockChangeType.OTHER]: '其他',
      [StockChangeType.STOCK_IN]: '入库',
      [StockChangeType.STOCK_OUT]: '出库',
      [StockChangeType.ORDER_LOCK]: '订单锁定',
      [StockChangeType.ORDER_RELEASE]: '订单释放',
      [StockChangeType.STOCK_TAKE_UP]: '盘点增加',
      [StockChangeType.STOCK_TAKE_DOWN]: '盘点减少',
  };