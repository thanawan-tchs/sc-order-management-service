export interface Warehouse {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
}

export interface Inventory {
  warehouseId: number;
  itemId: string;
  stock: number;
}
