Template.WidgetsBody.onRendered(function() {
	$('ul.tabs').tabs();
});

Template.WidgetsBody.created = function(){
	InstantiateScreens();
}

Template.WidgetsBody.helpers({
	myWidgetList: function(){
		wl =  Screens.find({  appId: {$ne: Meteor.settings.public.systemApp}, isWidget: true})
		return wl;
	},
	systemWidgetList: function(){
		wl =  Screens.find({ appId: Meteor.settings.public.systemApp, isWidget: true})
		return wl;
	}
});

Template.WidgetList.helpers({
	widgetTag: function(){
		console.log("WT: ", this)
		return "<"+this.widgetName+">";
	},
	widgetEndTag: function(){
		return "</"+this.widgetName+">";
	},
	iAmOwner: function() {
		if ( this.owner == Meteor.userId() ) {
			return true;
		} else {
			return false;
		}
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

