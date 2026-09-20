'use strict';
'require view';
'require uci';
'require ui';
'require rpc';

/*
 * mwanx 多出口管理
 *
 * 配置（接口 / 跃点 / 跟踪 IP）走 LuCI 内置的 uci 模块，浏览器直接读写；
 * 运行时状态（健康探测 / 当前生效出口 / 立即重选）走 luci.mwanx 后端。
 *
 * 拖拽排序写的是 uplink 的 order 选项（越小越优先），不是 UCI 段顺序 ——
 * form.GridSection 的 sortable 排的是段顺序，语义对不上。
 */

var callStatus = rpc.declare({ object: 'luci.mwanx', method: 'status', expect: {} });
var callCheck = rpc.declare({ object: 'luci.mwanx', method: 'check', expect: {} });
var callSyncMetrics = rpc.declare({ object: 'luci.mwanx', method: 'sync_metrics', expect: {} });
var callReloadNetwork = rpc.declare({ object: 'luci.mwanx', method: 'reload_network', expect: {} });
var callClear = rpc.declare({ object: 'luci.mwanx', method: 'clear', expect: {} });
var callScan = rpc.declare({ object: 'luci.mwanx', method: 'scan', expect: {} });

/* 粗筛，只挡明显打错的字，不追求把 IP 语法查全。 */
function looksLikeIp(s) {
	if (s.indexOf(':') >= 0)
		return /^[0-9a-fA-F:.]+$/.test(s) && /[0-9a-fA-F]/.test(s);

	var p = s.split('.');
	if (p.length != 4)
		return false;
	for (var i = 0; i < 4; i++)
		if (!/^[0-9]{1,3}$/.test(p[i]) || +p[i] > 255)
			return false;
	return true;
}

return view.extend({
	status: {},
	uplinks: [],
	ifaces: [],
	ifaceMap: {},
	/* 本会话里新建、还没落盘的段（临时 sid）。放弃的要在保存前撤掉，见 saveUci */
	pending: [],
	dragSrc: null,
	tableEl: null,

	/* 表头。渲染和就地重绘都用它，免得两份列表慢慢跑偏 */
	HEAD: [ '', '接口', '设备', '跃点', '跟踪 IP', '健康', '生效 / 启用', '' ],

	load: function() {
		return this.reloadStatus();
	},

	readUplinks: function() {
		var fam = (this.status && this.status.family) || {};
		var pending = this.pending;
		var list = [];
		var map = {};

		uci.sections('mwanx', 'uplink', function(s) {
			if (s.iface)
				map[s.iface] = s['.name'];
			list.push({
				name: s['.name'],
				order: parseInt(s.order, 10) || 99,
				enabled: (s.enabled == '1'),
				device: s.device || '',
				iface: s.iface || '',
				test_ip: s.test_ip || '',
				test_ip6: s.test_ip6 || '',
				family: fam[s['.name']] || '',
				pending: (pending.indexOf(s['.name']) >= 0)
			});
		});

		this.ifaceMap = map;
		list.sort(function(a, b) { return a.order - b.order; });
		return list;
	},

	/* 配置落盘。mwanx 守护进程每轮重读 uci，所以不需要重启服务。 */
	saveUci: function(msg) {
		var self = this;

		/* 还没选接口的空行不能跟着落盘，否则会留下一条没有 iface/device 的死出口。 */
		this.pending = this.pending.filter(function(sid) {
			if (uci.get('mwanx', sid, 'iface'))
				return true;
			uci.remove('mwanx', sid);
			return false;
		});

		return uci.save().then(function() {
			return uci.apply();
		}).then(function() {
			/* 存完段名会从临时 sid 换成服务端分配的，挂起表跟着清空 */
			self.pending = [];
			if (msg)
				ui.addNotification(null, E('p', {}, msg), 'info');
		}, function(err) {
			/* apply 失败时 rpcd 自己会回滚。报出来，调用方的 reloadStatus
			   会把配置重新拉一遍，表格跟着回到真实状态。 */
			self.pending = [];
			ui.addNotification(null, E('p', {}, '保存失败：' + err), 'danger');
		});
	},

	/* 后端（mwanx add / autoadd）直接用 uci 命令改配置，浏览器里缓存的副本不会
	   自己更新，所以每次操作后都要重拉 —— 否则新增的出口在页面上看不见。
	   注意：uci.unload() 是同步的、不返回 promise，返回 promise 的是 uci.load()。 */
	reloadUci: function() {
		uci.unload('mwanx');
		/* unload 会连挂起的新建段一起丢掉，挂起表跟着清 */
		this.pending = [];
		return uci.load('mwanx');
	},

	/* 状态 + 配置 + 接口清单一起重拉。接口清单也要刷：增删出口会改变
	   is_uplink 标记，下拉里的占用标注得跟得上。 */
	reloadStatus: function() {
		var self = this;
		return Promise.all([
			self.reloadUci(),
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callScan(), { interfaces: [] })
		]).then(function(d) {
			self.status = d[1] || {};
			self.ifaces = (d[2] && d[2].interfaces) || [];
			self.uplinks = self.readUplinks();
			self.reloadPage();
		});
	},

	/* ---------------- 拖拽排序 ---------------- */

	persistOrder: function() {
		if (!this.tableEl)
			return Promise.resolve();

		var rows = this.tableEl.querySelectorAll('tr[data-uplink]');
		for (var i = 0; i < rows.length; i++) {
			var name = rows[i].getAttribute('data-uplink');
			uci.set('mwanx', name, 'order', String((i + 1) * 10));
		}

		var self = this;
		return this.saveUci('跃点已保存').then(function() {
			/* 重拉而不是就地改数字：万一 apply 被后端的回滚撤了，
			   表格得跟着回到真实顺序 */
			return self.reloadStatus();
		});
	},

	/* ---------------- 接口下拉 ---------------- */

	findIface: function(name) {
		for (var i = 0; i < this.ifaces.length; i++)
			if (this.ifaces[i].name === name)
				return this.ifaces[i];
		return null;
	},

	/* 不按区域过滤，全部列出；被占用的接口也留在列表里并标出占用者，
	   否则没法从界面上看出某个接口正在被谁使用。 */
	renderIfaceSelect: function(u) {
		var self = this;
		var sel = E('select', { 'class': 'cbi-input-select' });
		var seen = {};
		var have = false;

		/* 占位项必须放最前，否则新行的 select.value = '' 会落成「一个都没选中」，
		   看起来像个坏掉的控件。 */
		if (!u.iface)
			sel.appendChild(E('option', { 'value': '' }, '— 选择接口 —'));

		this.ifaces.forEach(function(it) {
			if (seen[it.name])
				return;
			seen[it.name] = true;
			if (it.name === u.iface)
				have = true;

			var label = it.name;
			if (it.family)
				label += '  [' + it.family + ']';

			var owner = self.ifaceMap[it.name];
			if (owner && owner !== u.name)
				label += '  — 已被别的出口占用';

			sel.appendChild(E('option', { 'value': it.name }, label));
		});

		/* 配置里有、当前扫不到的接口也要留个选项，否则这个字段在页面上是空的。 */
		if (!have && u.iface)
			sel.appendChild(E('option', { 'value': u.iface },
				u.iface + '  — 当前（未扫到）'));

		if (!sel.options.length)
			sel.appendChild(E('option', { 'value': '' }, '(没扫到接口)'));

		sel.value = u.iface;

		sel.addEventListener('change', function() { return self.changeIface(u, sel); });
		return sel;
	},

	changeIface: function(u, sel) {
		var self = this;
		var val = sel.value;
		var old = u.iface || '';

		if (!val) {
			sel.value = old;
			return Promise.resolve();
		}

		var owner = this.ifaceMap[val];
		if (owner && owner !== u.name) {
			ui.addNotification(null, E('p', {},
				'接口 ' + val + ' 已经被另一个出口占用了'), 'danger');
			sel.value = old;
			return Promise.resolve();
		}

		/* device 是从接口推导的，必须一起写 —— 只改 iface 不改 device 的话，
		   健康探测会继续绑在旧设备上。 */
		var it = this.findIface(val);
		uci.set('mwanx', u.name, 'iface', val);
		if (it && it.device)
			uci.set('mwanx', u.name, 'device', it.device);

		return this.saveUci('已保存：' + (old || u.name) + ' → ' + val).then(function() {
			return self.reloadStatus();
		});
	},

	/* ---------------- 跟踪 IP ---------------- */

	/* 一个输入框，不分 v4/v6。写哪个字段由出口实际带的族决定：纯 v6 出口 mwanx
	   只读 test_ip6，双栈出口只探 v4。 */
	renderTestInput: function(u) {
		var self = this;
		var v6only = (u.family === '6');
		var key = v6only ? 'test_ip6' : 'test_ip';
		var cur = (v6only ? u.test_ip6 : u.test_ip) || '';
		var def = uci.get('mwanx', 'globals', key) || '';

		var input = E('input', {
			'class': 'cbi-input-text',
			'style': 'width: 12em;',
			'value': cur,
			'placeholder': def || '(用全局默认)'
		});
		if (this.isBlank(u))
			input.disabled = true;

		input.addEventListener('change', function() {
			var v = input.value.trim();

			if (v && !looksLikeIp(v)) {
				ui.addNotification(null, E('p', {},
					'「' + v + '」不像 IP 地址，没有保存'), 'danger');
				input.value = cur;
				return;
			}

			/* 空值在 uci 里等于删掉这个选项，mwanx 会退回 globals 的默认目标 */
			uci.set('mwanx', u.name, key, v);
			return self.saveUci(v
				? '已保存：' + (u.iface || u.name) + ' 的跟踪 IP'
				: '已清空 ' + (u.iface || u.name) + ' 的跟踪 IP，改用默认'
			).then(function() {
				cur = v;
				return self.reloadStatus();
			});
		});

		return input;
	},

	/* ---------------- 删除 ---------------- */

	removeUplink: function(u) {
		var self = this;
		var who = u.iface || u.name;

		/* 还没落盘的空行直接从浏览器里撤掉，路由器上还没有这个东西 */
		if (u.pending) {
			uci.remove('mwanx', u.name);
			this.pending = this.pending.filter(function(s) { return s !== u.name; });
			this.uplinks = this.readUplinks();
			this.reloadPage();
			return Promise.resolve();
		}

		if (!confirm('确定删除出口 ' + who + '？该段将从 /etc/config/mwanx 中移除。'))
			return Promise.resolve();

		uci.remove('mwanx', u.name);
		return this.saveUci('已删除出口 ' + who).then(function() {
			return self.reloadStatus();
		});
	},

	/* ---------------- 添加出口 ---------------- */

	/* 就地插一条空行。这一段先只活在浏览器里，等选了接口（或改了别的字段）
	   才随那次保存一起 commit，中途放弃由 saveUci 撤掉。 */
	addRow: function() {
		var sid = uci.add('mwanx', 'uplink');

		/* 排最后，和 autoadd 的规矩一致（现有最大值 + 10），拖一下就能挪走。 */
		var max = 0;
		this.uplinks.forEach(function(u) { if (u.order > max) max = u.order; });

		uci.set('mwanx', sid, 'enabled', '1');
		uci.set('mwanx', sid, 'order', String(max + 10));

		this.pending.push(sid);
		this.uplinks = this.readUplinks();
		this.reloadPage();
		this.focusIface(sid);
	},

	/* 加完下一步必然是选接口，光标直接送到那一行的下拉上 */
	focusIface: function(sid) {		if (!this.tableEl)
			return;
		var rows = this.tableEl.querySelectorAll('tr[data-uplink]');
		for (var i = 0; i < rows.length; i++) {
			if (rows[i].getAttribute('data-uplink') !== sid)
				continue;
			var sel = rows[i].querySelector('select');
			if (sel)
				sel.focus();
			return;
		}
	},

	/* 刚加、还没选接口的行：只能动接口下拉 —— 没有接口就没有设备，
	   探测、ifup、sync-metrics 都无从谈起。 */
	isBlank: function(u) {
		return !!(u.pending && !u.iface);
	},

	/* ---------------- 表格 ---------------- */

	renderHeadRow: function() {
		return E('tr', { 'class': 'tr table-titles' },
			this.HEAD.map(function(t) { return E('th', { 'class': 'th' }, t); }));
	},

	fillTable: function(table) {
		var self = this;
		table.appendChild(this.renderHeadRow());
		this.uplinks.forEach(function(u) { table.appendChild(self.renderRow(u)); });

		if (!this.uplinks.length)
			table.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'colspan': this.HEAD.length, 'style': 'color: #888;' },
					'暂无出口配置。')
			]));
	},

	renderRow: function(u) {
		var self = this;
		var up = this.status.up || {};
		var act4 = (this.status.active4 === u.name);
		var act6 = (this.status.active6 === u.name);
		var healthy = (up[u.name] == 1);

		var tr = E('tr', { 'class': 'tr', 'data-uplink': u.name });
		var blank = this.isBlank(u);

		/* 只有按在手柄上才把整行设成 draggable，否则行内输入框没法用鼠标选词。
		   空行不给拖：拖动结尾会存一次盘，而空行会被 saveUci 丢掉。 */
		var handle = E('td', {
			'class': 'td',
			'style': 'width: 24px; color: #999; ' +
				(blank ? '' : 'cursor: grab; ') +
				'user-select: none; -webkit-user-select: none;'
		}, '⠿');
		if (!blank) {
			handle.addEventListener('mousedown', function() { tr.draggable = true; });
			handle.addEventListener('mouseup', function() { tr.draggable = false; });
		}
		tr.appendChild(handle);

		/* 接口 —— 下拉，选中即写 */
		tr.appendChild(E('td', { 'class': 'td' }, this.renderIfaceSelect(u)));

		/* 设备 —— 只读。上面那个下拉会一起写，两个字段各说各话最容易绑错源 */
		tr.appendChild(E('td', { 'class': 'td' }, u.device || '—'));

		/* 跃点 —— order，拖动改；sync-metrics 也是读它写 network.metric */
		tr.appendChild(E('td', { 'class': 'td' }, String(u.order)));

		/* 跟踪 IP —— 行内输入框 */
		tr.appendChild(E('td', { 'class': 'td' }, this.renderTestInput(u)));

		/* 健康 —— 还没选接口的行没有设备可绑，探不了，显示 — 而不是 DOWN */
		tr.appendChild(E('td', { 'class': 'td' },
			u.device
				? E('span', {
					'style': 'color: ' + (healthy ? 'green' : 'red') + '; font-weight: bold;'
				}, healthy ? '● up' : '● DOWN')
				: E('span', { 'style': 'color: #aaa;' }, '—')
		));

		/* 生效状态 + 启用开关 */
		var toggle = E('input', { 'type': 'checkbox' });
		toggle.checked = u.enabled;
		if (blank)
			toggle.disabled = true;
		toggle.addEventListener('change', function() {
			uci.set('mwanx', u.name, 'enabled', toggle.checked ? '1' : '0');
			return self.saveUci((toggle.checked ? '已启用 ' : '已停用 ') + (u.iface || u.name))
				.then(function() { return self.reloadStatus(); });
		});

		tr.appendChild(E('td', { 'class': 'td' }, [
			act4 ? E('span', { 'style': 'color: #0a0; font-weight: bold;' }, 'v4 ') : '',
			act6 ? E('span', { 'style': 'color: #0a0; font-weight: bold;' }, 'v6 ') : '',
			toggle
		]));

		/* 删除 —— 放最右边，离别的控件远一点 */
		var btnDel = E('button', { 'class': 'btn cbi-button cbi-button-remove' }, '删除');
		btnDel.addEventListener('click', function() { return self.removeUplink(u); });
		tr.appendChild(E('td', { 'class': 'td' }, btnDel));

		/* ---- 拖拽事件 ---- */
		tr.draggable = false;

		/* 空行自己不发起拖拽，但要能当落点 —— 否则别的行拖不到它下面去 */
		if (!blank) {
			tr.addEventListener('dragstart', function(ev) {
				self.dragSrc = tr;
				tr.style.opacity = '0.4';
				ev.dataTransfer.effectAllowed = 'move';
				try { ev.dataTransfer.setData('text/plain', u.name); } catch (e) {}
			});

			tr.addEventListener('dragend', function() {
				tr.style.opacity = '';
				tr.draggable = false;
				if (self.dragSrc) {
					self.dragSrc = null;
					self.persistOrder();
				}
			});
		}

		tr.addEventListener('dragover', function(ev) {
			ev.preventDefault();
			ev.dataTransfer.dropEffect = 'move';
			var src = self.dragSrc;
			if (!src || src === tr)
				return;
			var rect = tr.getBoundingClientRect();
			var after = (ev.clientY - rect.top) > rect.height / 2;
			tr.parentNode.insertBefore(src, after ? tr.nextSibling : tr);
		});

		tr.addEventListener('drop', function(ev) { ev.preventDefault(); });

		return tr;
	},

	render: function() {
		var self = this;

		var table = E('table', { 'class': 'table' });
		this.tableEl = table;
		this.fillTable(table);

		/* ---- 动作按钮 ---- */
		var btnAdd = E('button', { 'class': 'btn cbi-button cbi-button-add' }, '添加出口');
		btnAdd.addEventListener('click', function() {
			return self.addRow();
		});

		var btnCheck = E('button', { 'class': 'btn cbi-button cbi-button-action' }, '立即重选');
		btnCheck.addEventListener('click', function() {
			/* uci 一起重拉：守护进程可能刚自动纳管了新出口 */
			return callCheck().then(function() {
				return self.reloadStatus();
			});
		});

		var btnRefresh = E('button', { 'class': 'btn cbi-button' }, '刷新');
		btnRefresh.addEventListener('click', function() {
			return self.reloadStatus();
		});

		var btnSync = E('button', { 'class': 'btn cbi-button' }, '同步跃点');
		btnSync.addEventListener('click', function() {
			return callSyncMetrics().then(function(r) {
				ui.addNotification(null, E('div', {}, [
					E('p', {}, '已同步跃点，需重载网络后生效。'),
					r.out ? E('pre', { 'style': 'font-size: 11px;' }, r.out) : ''
				]), 'warning');
			});
		});

		/* 破坏性比其他按钮大，先确认再跑 */
		var btnReloadNet = E('button', { 'class': 'btn cbi-button' }, '重载网络');
		btnReloadNet.addEventListener('click', function() {
			if (!confirm('确定重载网络？全部接口将重新配置，现有连接短暂中断。'))
				return Promise.resolve();

			return callReloadNetwork().then(function(r) {
				ui.addNotification(null, E('div', {}, [
					E('p', {}, r.rc ? '重载网络失败。' : '已重载网络。'),
					r.out ? E('pre', { 'style': 'font-size: 11px;' }, r.out) : ''
				]), r.rc ? 'danger' : 'info');
				return self.reloadStatus();
			});
		});

		var btnClear = E('button', { 'class': 'btn cbi-button cbi-button-reset' }, '清除覆盖路由');
		btnClear.addEventListener('click', function() {
			return callClear().then(function() {
				ui.addNotification(null, E('p', {}, '已清除覆盖路由。'), 'warning');
				return self.reloadStatus();
			});
		});

		return E('div', {}, [
			E('h2', {}, 'MultiWanx'),
			E('p', { 'class': 'cbi-value-description' },
				'按跃点从小到大选出口，数字越小越优先。改动即时生效，无需重启服务。'),

			E('div', { 'class': 'cbi-page-actions', 'style': 'margin: 0.4em 0 1em 0;' }, [
				btnAdd, ' ', btnCheck, ' ', btnRefresh, ' ', btnSync, ' ',
				btnReloadNet, ' ', btnClear
			]),

			table
		]);
	},

	reloadPage: function() {
		/* 就地重绘表格，避免整页刷新丢滚动位置 */
		if (!this.tableEl)
			return;

		while (this.tableEl.firstChild)
			this.tableEl.removeChild(this.tableEl.firstChild);

		this.fillTable(this.tableEl);
	}
});
