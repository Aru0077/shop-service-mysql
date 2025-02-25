// src/constants/orderStatus.enum.ts

/**
 * 订单状态枚举
 */
export enum OrderStatus {
      // 待付款
      PENDING_PAYMENT = 1,
      
      // 待发货（已付款）
      PENDING_SHIPMENT = 2,
      
      // 已发货
      SHIPPED = 3,
      
      // 已完成
      COMPLETED = 4,
      
      // 已取消
      CANCELLED = 5,
  }
  
  /**
   * 订单状态文本描述
   */
  export const OrderStatusText = {
      [OrderStatus.PENDING_PAYMENT]: '待付款',
      [OrderStatus.PENDING_SHIPMENT]: '待发货',
      [OrderStatus.SHIPPED]: '已发货',
      [OrderStatus.COMPLETED]: '已完成',
      [OrderStatus.CANCELLED]: '已取消',
  };
  
  /**
   * 支付状态枚举
   */
  export enum PaymentStatus {
      // 未支付
      UNPAID = 0,
      
      // 已支付
      PAID = 1,
  }
  
  /**
   * 支付状态文本描述
   */
  export const PaymentStatusText = {
      [PaymentStatus.UNPAID]: '未支付',
      [PaymentStatus.PAID]: '已支付',
  };