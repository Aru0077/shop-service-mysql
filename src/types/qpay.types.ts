// src/types/qpay.types.ts

// QPay认证响应
export interface QPayAuthResponse {
      token_type: string;
      expires_in: number;
      access_token: string;
      refresh_token?: string;
}

// QPay发票请求
export interface QPayInvoiceRequest {
      invoice_code: string;
      sender_invoice_no: string;
      invoice_receiver_code: string;
      invoice_description: string;
      amount: number;
      callback_url: string;
      sender_branch_code?: string;
      enable_expiry?: boolean;
      allow_partial?: boolean;
      minimum_amount?: number;
      allow_exceed?: boolean;
      maximum_amount?: number;
      invoice_receiver_data?: {
            register?: string;
            name?: string;
            email?: string;
            phone?: string;
      };
}

// QPay发票响应
export interface QPayInvoiceResponse {
      invoice_id: string;
      qr_text: string;
      qr_image: string;
      invoice_url: string;
      deep_link?: string;
      urls?: {
            name: string;
            description: string;
            logo: string;
            link: string;
      }[];
}

// QPay支付检查请求
export interface QPayPaymentCheckRequest {
      object_type: 'INVOICE' | 'QPAY_ACCOUNT';
      object_id: string;
      offset?: {
            page_number: number;
            page_limit: number;
      };
}

// QPay支付检查响应
export interface QPayPaymentCheckResponse {
      count: number;
      paid_amount: number;
      rows: QPayPayment[];
}

// QPay支付信息
export interface QPayPayment {
      payment_id: string;
      payment_status: string;
      payment_date: string;
      payment_fee: number;
      payment_amount: number;
      payment_currency: string;
      payment_wallet: string;
      transaction_type: string;
}