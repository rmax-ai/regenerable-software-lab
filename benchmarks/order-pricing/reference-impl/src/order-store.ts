// order-store.ts — In-memory order store with idempotency key tracking

import { v4 as uuidv4 } from "uuid";
import { calculateLineTotal, calculateOrderTotals } from "./calculator.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface OrderItem {
  id: string;
  productId: string;
  name: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface PercentageDiscount {
  id: string;
  type: "percentage";
  value: string;
}

export interface FixedDiscount {
  id: string;
  type: "fixed";
  value: string;
}

export type Discount = PercentageDiscount | FixedDiscount;

export type OrderStatus = "draft" | "calculated";

export interface Order {
  id: string;
  status: OrderStatus;
  currency: "USD" | "EUR" | "GBP";
  items: OrderItem[];
  discounts: Discount[];
  taxRate: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderParams {
  id?: string;
  currency: "USD" | "EUR" | "GBP";
  taxRate: string;
}

export interface AddItemParams {
  productId: string;
  name: string;
  unitPrice: string;
  quantity: number;
}

export interface UpdateItemParams {
  quantity: number;
}

export type DiscountType = "percentage" | "fixed";

export interface AddDiscountParams {
  type: DiscountType;
  value: string;
}

// ── Store ──────────────────────────────────────────────────────────────

export class OrderStore {
  /** Map<orderId, Order> */
  private orders: Map<string, Order> = new Map();

  /**
   * Idempotency key tracking.
   * Map<idempotencyKey, { resourceType: string; resourceId: string }>
   */
  private idempotencyKeys: Map<
    string,
    { resourceType: string; resourceId: string }
  > = new Map();

  // ── Order Operations ─────────────────────────────────────────────────

  createOrder(params: CreateOrderParams): Order {
    const now = new Date().toISOString();
    const order: Order = {
      id: params.id ?? uuidv4(),
      status: "draft",
      currency: params.currency,
      items: [],
      discounts: [],
      taxRate: params.taxRate,
      subtotal: "0.00",
      discountTotal: "0.00",
      taxTotal: "0.00",
      grandTotal: "0.00",
      createdAt: now,
      updatedAt: now,
    };
    this.orders.set(order.id, order);
    return order;
  }

  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  /** Assert that an order exists and is in draft status. Throws on calculated. */
  assertDraft(orderId: string): Order {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new NotFoundError("Order not found");
    }
    if (order.status === "calculated") {
      throw new ConflictError("Order is already calculated and cannot be modified");
    }
    return order;
  }

  updateOrder(orderId: string, updates: Partial<Order>): Order {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new NotFoundError("Order not found");
    }
    const updated: Order = {
      ...order,
      ...updates,
      id: order.id, // never change id
      updatedAt: new Date().toISOString(),
    };
    this.orders.set(orderId, updated);
    return updated;
  }

  // ── Item Operations ──────────────────────────────────────────────────

  addItem(orderId: string, params: AddItemParams): OrderItem {
    const order = this.assertDraft(orderId);

    const lineTotal = calculateLineTotal(params.unitPrice, params.quantity);

    const item: OrderItem = {
      id: uuidv4(),
      productId: params.productId,
      name: params.name,
      unitPrice: params.unitPrice,
      quantity: params.quantity,
      lineTotal,
    };

    order.items.push(item);
    order.updatedAt = new Date().toISOString();
    this.orders.set(orderId, order);

    return item;
  }

  updateItem(orderId: string, itemId: string, params: UpdateItemParams): OrderItem {
    const order = this.assertDraft(orderId);
    const index = order.items.findIndex((i) => i.id === itemId);
    if (index === -1) {
      throw new NotFoundError("Item not found");
    }

    const item = order.items[index]!;
    item.quantity = params.quantity;
    item.lineTotal = calculateLineTotal(item.unitPrice, params.quantity);

    order.items[index] = item;
    order.updatedAt = new Date().toISOString();
    this.orders.set(orderId, order);

    return item;
  }

  removeItem(orderId: string, itemId: string): void {
    const order = this.assertDraft(orderId);
    const index = order.items.findIndex((i) => i.id === itemId);
    if (index === -1) {
      throw new NotFoundError("Item not found");
    }
    order.items.splice(index, 1);
    order.updatedAt = new Date().toISOString();
    this.orders.set(orderId, order);
  }

  // ── Discount Operations ──────────────────────────────────────────────

  addDiscount(orderId: string, params: AddDiscountParams): Discount {
    const order = this.assertDraft(orderId);

    const discount: Discount = {
      id: uuidv4(),
      type: params.type,
      value: params.value,
    } as Discount;

    order.discounts.push(discount);
    order.updatedAt = new Date().toISOString();
    this.orders.set(orderId, order);

    return discount;
  }

  removeDiscount(orderId: string, discountId: string): void {
    const order = this.assertDraft(orderId);
    const index = order.discounts.findIndex((d) => d.id === discountId);
    if (index === -1) {
      throw new NotFoundError("Discount not found");
    }
    order.discounts.splice(index, 1);
    order.updatedAt = new Date().toISOString();
    this.orders.set(orderId, order);
  }

  // ── Calculation ──────────────────────────────────────────────────────

  calculateOrder(orderId: string): Order {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new NotFoundError("Order not found");
    }
    if (order.status === "calculated") {
      // Re-calculation returns existing values unchanged (I-10)
      return order;
    }

    const totals = calculateOrderTotals(order.items, order.discounts, order.taxRate);

    order.subtotal = totals.subtotal;
    order.discountTotal = totals.discountTotal;
    order.taxTotal = totals.taxTotal;
    order.grandTotal = totals.grandTotal;
    order.status = "calculated";
    order.updatedAt = new Date().toISOString();
    this.orders.set(orderId, order);

    return order;
  }

  // ── Idempotency Key Operations ───────────────────────────────────────

  hasIdempotencyKey(key: string): boolean {
    return this.idempotencyKeys.has(key);
  }

  getIdempotencyKey(key: string): { resourceType: string; resourceId: string } | undefined {
    return this.idempotencyKeys.get(key);
  }

  setIdempotencyKey(
    key: string,
    value: { resourceType: string; resourceId: string }
  ): void {
    this.idempotencyKeys.set(key, value);
  }

  checkAndSetIdempotencyKey(
    key: string,
    resourceType: string,
    resourceId: string
  ): { isDuplicate: boolean; existingResourceId?: string } {
    const existing = this.idempotencyKeys.get(key);
    if (existing) {
      return { isDuplicate: true, existingResourceId: existing.resourceId };
    }
    this.idempotencyKeys.set(key, { resourceType, resourceId });
    return { isDuplicate: false };
  }
}

// ── Error Types ────────────────────────────────────────────────────────

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
