// Template.afSelectMultiple.onRendered(function() {
// 	$('select').material_select();
// });

// Template.afQuickField.onRendered(function() {
// 	$('select').material_select();
// });

Template.afObjectField.onRendered(function() {
	$('select').material_select('destroy');
	// $('span.caret').not($('.select-wrapper span.caret')).remove();
	$('select').material_select();
	// $('span.caret').not($('.select-wrapper span.caret')).remove();
});

Template.updateScreenForm.onRendered(function() {
	$('ul.tabs').tabs();
	$('select').material_select();
	// $('span.caret').not($('.select-wrapper span.caret')).remove();
});

Template.updateScreenForm.events({
	'click .close': function(e, tmpl) {
		tmpl.find(".alert").remove();
		Alerts.remove(this._id);
	},
	'click #jstab': function(e, tmpl){
		// console.log("JSTAB")
		AceEditor.instance("archyjs").resize();
		// AceEditor.instance("archyjs").renderer.updateFull()
	},
	'click .clear-alerts': function(e, tmpl) {
		Alerts.remove({});
	}
});

Template.updateScreenForm.helpers({
	currentScreen: function() {
		scr =  Session.get("currentScreenPage");
		scn = Screens.findOne(scr);
		//console.log("HTML: ", scn);
		if(scn) {
			//console.log("HTML: ", scn.html);
			delete Template[scn.title];
			compileTemplate(scn.title, scn.html, scn.js);
			return scn.title;
		} else {
			return "NoScreen";
		}
	},
	alerts: function() {
		return Alerts.find();
	},
	alertType: function() {
		if (this.type === 'template' && this.status === 'success') {
			return 'Success:';
		} else if (this.type === 'template') {
			return 'Template Error:';
		} else if (this.type === 'runtime') {
			return 'Runtime Error:';
		} else {
			console.log('alertType else case firing')
		}
	},
	widgetDoc: function() {
		return Widgets.findOne({baseScreen: this._id});
	},
	alertCount: function() {
		return Alerts.find().count();
	}
});