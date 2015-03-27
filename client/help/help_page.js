Template.HelpPage.helpers({
	nextpage: function(){
		console.log("PN ", this.pagenumber)
		hp =  HelpPages.findOne({pagenumber: {$gt: this.pagenumber}});
		console.log("HP: ", hp);
		return hp.urlstring;
	},
	prevpage: function(){
		console.log("PN ", this.pagenumber)
		hp =  HelpPages.findOne({pagenumber: {$lt: this.pagenumber}});
		console.log("HP: ", hp);
		return hp.urlstring;
	},
	publishedDate: function(date) {
		return moment(date).format('MMMM D, YYYY');
	}
})