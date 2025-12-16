import { Box, Text } from "@saleor/macaw-ui";
import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode } from "react";

interface NavItemProps {
  href: string;
  label: string;
  isActive: boolean;
}

const NavItem = ({ href, label, isActive }: NavItemProps) => (
  <Link href={href} style={{ textDecoration: "none" }}>
    <Box
      paddingX={4}
      paddingY={3}
      borderRadius={2}
      backgroundColor={isActive ? "default2" : undefined}
      cursor="pointer"
      className="nav-item"
    >
      <Text fontWeight={isActive ? "bold" : "regular"}>{label}</Text>
    </Box>
  </Link>
);

interface AppLayoutProps {
  children: ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => {
  const router = useRouter();
  const currentPath = router.pathname;

  const navItems = [
    { href: "/purchase-orders", label: "Purchase Orders" },
    { href: "/suppliers", label: "Suppliers" },
    { href: "/goods-receipts", label: "Goods Receipts" },
  ];

  const reportItems = [
    { href: "/reports/inventory-value", label: "Inventory Value" },
    { href: "/reports/cost-history", label: "Cost History" },
  ];

  return (
    <Box display="flex" gap={6}>
      {/* Sidebar Navigation */}
      <Box
        __width="200px"
        __minWidth="200px"
        display="flex"
        flexDirection="column"
        gap={1}
        paddingTop={2}
      >
        <Box marginBottom={4}>
          <Text size={6} fontWeight="bold">
            Inventory Ops
          </Text>
        </Box>
        {navItems.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            isActive={currentPath.startsWith(item.href)}
          />
        ))}

        {/* Reports Section */}
        <Box marginTop={4} marginBottom={2}>
          <Text size={3} color="default2">
            Reports
          </Text>
        </Box>
        {reportItems.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            isActive={currentPath.startsWith(item.href)}
          />
        ))}
      </Box>

      {/* Main Content */}
      <Box __flex="1">{children}</Box>
    </Box>
  );
};
