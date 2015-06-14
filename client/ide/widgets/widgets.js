Template.WidgetsBody.onRendered(function() {
	$('ul.tabs').tabs();
});

Template.WidgetsBody.created = function(){
	InstantiateScreens();
}

Template.WidgetsBody.helpers({
	widgetlist: function(){
		wl =  Screens.find({ owner: Meteor.userId(), isWidget: true})
		return wl;
	},
	widgetTag: function(){
		console.log("WT: ", this)
		return "<"+this.widgetName+">";
	},
	widgetEndTag: function(){
		return "</"+this.widgetName+">";
	}
});

Template.WidgetsHeader.events({
	"click .header-action-1": function(e, tmpl) {
		e.preventDefault();
		menuOps();
		$('.add-new-item select').material_select();
	}
});

Template.WidgetsNewItem.events({
	"click .table-cancel-new": function(e, tmpl) {
		menuOps();
	},
	"click .divider-decoration": function(e, tmpl) {
		menuOps();
	}
});

