Template.EditAppBody.events({

	'click #app-doc-tab': function(e, tmpl){
		AceEditor.instance("archyappdoc").resize();
		// AceEditor.instance("archyjs").renderer.updateFull()
	},
	'click #app-css-tab': function(e, tmpl){
		AceEditor.instance("archyappcss").resize();
		// AceEditor.instance("archyjs").renderer.updateFull()
	},
	'click #app-js-tab': function(e, tmpl){
		AceEditor.instance("archyappjs").resize();
		// AceEditor.instance("archyjs").renderer.updateFull()
	},

});

Template.EditAppBody.onRendered(function() {
	// $('select').material_select();
	$('ul.tabs').tabs();
});

Template.EditAppBody.helpers({
	log: function(n) {
		console.log(n);
	},
	share_url: function(){
		// console.log(this)
		return "http://" + Meteor.settings.public.domain + "/app/" + this._id;
	}
});

Template.EditAppHeader.helpers({
	domain: function(){
		return Meteor.settings.public.domain;
	}
})

Meteor.startup(function(){
	AutoForm.addInputType("boolean-checkbox-M", {
		template: "afCheckbox_materialiseCheckbox",
		valueOut: function () {
		return !!this.is(":checked");
	},
	valueConverters: {
		"string": function (val) {
			if (val === true) {
				return "TRUE";
		} else if (val === false) {
			return "FALSE";
		}
		return val;
	},
	"stringArray": function (val) {
		if (val === true) {
			return ["TRUE"];
		} else if (val === false) {
			return ["FALSE"];
		}
		return val;
	},
	"number": function (val) {
		if (val === true) {
			return 1;
		} else if (val === false) {
			return 0;
		}
		return val;
	},
	"numberArray": function (val) {
		if (val === true) {
			return [1];
		} else if (val === false) {
			return [0];
		}
			return val;
		}
	},
	contextAdjust: function (context) {
		if (context.value === true) {
			context.atts.checked = "";
		}
		//don't add required attribute to checkboxes because some browsers assume that to mean that it must be checked, which is not what we mean by "required"
		delete context.atts.required;
		return context;
		}
	});

	AutoForm.addInputType("password", {
		template: "afInputPassword",
		valueConverters: {
			"stringArray": function (val) {
				if (typeof val === "string" && val.length > 0) {
					return [val];
				}
				return val;
			}
		},
		contextAdjust: function (context) {
			if (typeof context.atts.maxlength === "undefined" && typeof context.max === "number") {
				context.atts.maxlength = context.max;
			}
			return context;
		}
	});
});