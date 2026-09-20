#
# mwanx - 多出口优先级管理与故障切换
#
# 本体是 shell 脚本，前端是一份 LuCI 视图，两者都没有编译产物，
# 所以 PKGARCH:=all（不跟架构绑定）。源码就是本目录，直接从 $(CURDIR) 装，
# 不走下载/解包那一套。
#
# 前端不单独成包：htdocs/ 和 root/ 按部署路径摆好，装的时候铺到 $(1)/www 和 $(1)，
# 这正是 luci.mk 内部做的事。于是不依赖 feeds/luci，也不用再管 luci.mk
# 那套版本退化算法。不想要网页面板就关掉下面的开关。
#

include $(TOPDIR)/rules.mk

PKG_NAME:=mwanx
# 脚本改动没有天然的版本号，拿构建时间当版本，保证每次构建都比上一次大。
PKG_VERSION:=$(shell date -u +%y.%j.%s)
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/mwanx
  SECTION:=net
  CATEGORY:=Network
  TITLE:=多出口优先级管理与故障切换
  # 纯脚本包不绑架构。该赋值必须写在 Package/<名字> 里面 ——
  # package-defaults.mk 的 Package/Default 里有条无条件的 PKGARCH:=$(ARCH_PACKAGES)，
  # 写在顶层会被它盖掉，包就被绑死成构建目标架构。
  PKGARCH:=all
  # 面板要 luci-base；关掉开关时这条依赖也不同时生成，
  # 于是不带 luci feed 的 SDK 也能编。
  DEPENDS:=+PACKAGE_MWANX_LUCI:luci-base
endef

define Package/mwanx/config
	config PACKAGE_MWANX_LUCI
		bool "包含 LuCI 网页面板"
		default y
		help
		  Install the LuCI web panel (Services -> MultiWanX).
		  Turn this off for a router without LuCI: only the mwanx
		  daemon and CLI get installed then.
endef

define Package/mwanx/description
  mwanx：按优先级 ping 探测各出口，不通就自动切到下一个；接口掉线由 netifd
  hotplug 钩子触发秒级切换。默认附带 LuCI 网页面板。
endef

# 配置按 conffile 装 —— 升级/重装时保留用户改过的那份，不拿包里的默认值覆盖。
define Package/mwanx/conffiles
/etc/config/mwanx
endef

# 没有源码要解包，但 package.mk 的流程要求 PKG_BUILD_DIR 存在
define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

# 没有东西要编译。但 package.mk 默认会到 PKG_BUILD_DIR 里跑一次 make，
# 那儿是空的，会以 "No targets specified and no makefile found" 失败。
define Build/Compile
endef

define Package/mwanx/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(CURDIR)/usr/bin/mwanx $(1)/usr/bin/mwanx
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) $(CURDIR)/etc/init.d/mwanx $(1)/etc/init.d/mwanx
	$(INSTALL_DIR) $(1)/etc/hotplug.d/iface
	$(INSTALL_BIN) $(CURDIR)/etc/hotplug.d/iface/99-mwanx $(1)/etc/hotplug.d/iface/99-mwanx
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_DATA) $(CURDIR)/etc/config/mwanx $(1)/etc/config/mwanx
	# 原始配置另存一份。conffile 的机制是"用户改过就保留用户那份"，
	# 界面上「恢复默认配置」要覆盖回去，就得有一份不受 conffile 保护的副本。
	$(INSTALL_DIR) $(1)/usr/share/mwanx
	$(INSTALL_DATA) $(CURDIR)/etc/config/mwanx $(1)/usr/share/mwanx/mwanx.default
	# 面板。条件写在每行上，而不是在 define 里塞 ifneq ——
	# define 体里的条件指令不会在配方展开时生效，只会在 $(eval) 时才处理。
	$(if $(CONFIG_PACKAGE_MWANX_LUCI),$(INSTALL_DIR) $(1)/www)
	$(if $(CONFIG_PACKAGE_MWANX_LUCI),$(CP) $(CURDIR)/htdocs/. $(1)/www/)
	$(if $(CONFIG_PACKAGE_MWANX_LUCI),$(CP) $(CURDIR)/root/. $(1)/)
endef

$(eval $(call BuildPackage,mwanx))
