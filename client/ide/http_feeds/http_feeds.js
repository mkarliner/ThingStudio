// Template.HTTPFeedsHeader.events({
// 	"click .header-action-1": function(e, tmpl) {
// 		e.preventDefault();
// 		menuOps();
// 	}
// });
//
// Template.HTTPFeedsNewItem.events({
// 	"click .table-cancel-new": function(e, tmpl) {
// 		e.preventDefault();
// 		menuOps();
// 	},
// 	"click .divider-decoration": function(e, tmpl) {
// 		e.preventDefault();
// 		menuOps();
// 	}
// });
//
// Template.HTTPFeedsBody.helpers({
// 	http_feedlist: function(){
// 		return HTTPFeeds.find({}, {sort: {createdAt: -1}})
// 	},
// 	connection: function(){
// 		return HTTPConnections.findOne( this.connection).title;
// 	},
// 	publichttp_feeds: function() {
// 		return HTTPFeeds.find({public: true})
// 	},
// 	ownerName: function(){
// 		owner = Meteor.users.findOne({_id: this.owner});
// 		return owner ? owner.username : "Owner Unknown";
// 	}
// });
